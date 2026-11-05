// REPLY-007 (AD-3 step 3): deploys the committed contact-form Flow JSON to a
// tenant's WABA. Mirrors template-client.ts's `getClient()` / no-API-key-skip
// posture: missing config or any failure degrades to a Result, never throws.
//
// Deliberately does NOT use the SDK's `flows.deploy()` convenience wrapper
// (issue #78). `deploy()` is create-then-publish, but it forwards no
// `phoneNumberId` to its internal `publish()` call, and every flow-scoped
// Kapso route (`/{flowId}`, `/{flowId}/publish`, `/{flowId}/deprecate`) needs
// one: a bare flow id gives the proxy no way to pick a WhatsApp config, so it
// answers 404 `{"error":"WhatsApp configuration not found"}`. Verified against
// the live API — `GET /v23.0/{flowId}` 404s while
// `GET /v23.0/{flowId}?phone_number_id=...` returns the flow. `waba_id` and
// `business_account_id` do NOT work; `phone_number_id` is the only routing key.
// So the two steps are issued here instead, with the phone number id threaded
// explicitly. `flows.create` is WABA-scoped (`/{wabaId}/flows`) and needs no
// such routing.
//
// Each call CREATEs a new flow (no lookup-by-name), so each tenant WABA gets
// its own freshly created flow. The real idempotency guard is
// `getContactFlowIdStrict` in the caller (AD-3 step 1).
//
// Create and publish are separate failure domains: a create that succeeds and
// a publish that then fails leaves a DRAFT flow at Meta that no longer has an
// id anywhere in our system. That orphan is best-effort DELETEd here rather
// than leaked — before this fix, every failed save added one.
//
// Flow names must be unique within a WABA, and a deprecated Flow permanently
// occupies its name — reusing it returns Meta error 100, "Flow name is not
// unique" (developers.facebook.com/docs/whatsapp/flows/reference/error-codes).
// Nothing in this system looks a flow up by name (the id persisted to
// `restaurants.whatsapp_contact_flow_id` is the source of truth), so
// `generateFlowName()` mints a fresh name — identifiable prefix + timestamp +
// random suffix — on every create. That makes a collision structurally
// impossible: `--force` redeploys no longer collide with the flow they just
// deprecated, and a retry after an unpersisted-but-Meta-succeeded create
// always gets a brand-new name instead of re-hitting the same one.

import { WhatsAppClient, GraphApiError } from '@kapso/whatsapp-cloud-api'
import type { FlowValidationError } from '@kapso/whatsapp-cloud-api'
import { randomUUID } from 'crypto'
import flowJson from '@/infrastructure/whatsapp/flows/contact-form-flow.json'

const KAPSO_BASE_URL = 'https://api.kapso.ai/meta/whatsapp'
const CONTACT_FLOW_NAME_PREFIX = 'ohmyclient_contact_form'

/** Fresh, human-identifiable name per create attempt — see module doc above. */
function generateFlowName(): string {
  return `${CONTACT_FLOW_NAME_PREFIX}_${Date.now()}_${randomUUID().slice(0, 8)}`
}

/**
 * Meta error 100 is a generic "invalid parameter" code shared by many
 * unrelated validation failures, so the message text is also required
 * before treating it as the specific name-collision case.
 */
function isFlowNameCollision(err: unknown): err is GraphApiError {
  return err instanceof GraphApiError && err.code === 100 && /not unique/i.test(err.message)
}

// Bounds how long a stalled Meta flow-deploy round-trip can hold the caller
// open. This use-case is invoked synchronously from an admin save (never the
// webhook hot path) — an unbounded provider call would hang that request.
// The SDK gives its flow calls no way to pass an AbortSignal, so the whole
// create + publish sequence is raced against one timer here instead — same
// lesson as the Resend adapter's `AbortSignal.timeout` fix, applied via our
// own race since no signal hook exists to plug into. Bounding the pair as a
// unit (rather than each call) keeps the caller's worst case unchanged.
export const DEPLOY_TIMEOUT_MS = 15_000

let cachedClient: WhatsAppClient | null = null

function getClient(): WhatsAppClient | null {
  if (cachedClient) return cachedClient

  const kapsoApiKey = process.env.KAPSO_API_KEY
  if (!kapsoApiKey) return null

  cachedClient = new WhatsAppClient({ kapsoApiKey, baseUrl: KAPSO_BASE_URL })
  return cachedClient
}

export type DeployContactFlowErrorTitle =
  | 'kapso_no_api_key'
  | 'flow_no_phone_number_id'
  | 'flow_validation_error'
  | 'flow_deploy_timeout'
  | 'flow_name_not_unique'
  | 'flow_deploy_error'

export interface DeployContactFlowResult {
  ok: boolean
  flowId: string | null
  validationErrors?: FlowValidationError[]
  error?: { title: DeployContactFlowErrorTitle; details?: string }
}

// Exported so other callers (currently `ensure-contact-flow-deployed.ts`,
// H1) can bound their own unbounded calls the same way `deployContactFlow`
// bounds its create + publish pair — the SDK has no timeout/AbortSignal
// support anywhere, so this race is the only way to cap a stalled round-trip.
export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Timed out after ${ms}ms`)
    this.name = 'TimeoutError'
  }
}

/** Races a promise against a timer; always settles, never leaks the timer. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(ms)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

export async function deployContactFlow(
  wabaId: string,
  phoneNumberId: string
): Promise<DeployContactFlowResult> {
  const client = getClient()
  if (!client) {
    return { ok: false, flowId: null, error: { title: 'kapso_no_api_key' } }
  }
  if (!phoneNumberId) {
    // Publishing is unroutable without it, and a create we can't publish is
    // exactly the orphan this function exists to avoid — so refuse up front
    // rather than leave a DRAFT flow behind.
    return { ok: false, flowId: null, error: { title: 'flow_no_phone_number_id' } }
  }

  try {
    return await withTimeout(createAndPublish(client, wabaId, phoneNumberId), DEPLOY_TIMEOUT_MS)
  } catch (err) {
    if (err instanceof TimeoutError) {
      console.warn(`[Kapso] Flow deploy timed out after ${DEPLOY_TIMEOUT_MS}ms`)
      return { ok: false, flowId: null, error: { title: 'flow_deploy_timeout' } }
    }
    if (isFlowNameCollision(err)) {
      console.warn('[Kapso] Flow name collision on create (unexpected — names are unique per attempt):', err.message)
      return {
        ok: false,
        flowId: null,
        error: {
          title: 'flow_name_not_unique',
          details:
            'Meta rejected the flow name as already in use. This should not recur — retry, which will generate a new unique name automatically.',
        },
      }
    }
    const message = err instanceof Error ? err.message : String(err)
    console.warn('[Kapso] Error deploying contact flow:', message)
    return { ok: false, flowId: null, error: { title: 'flow_deploy_error', details: message } }
  }
}

/**
 * The create + publish pair, as two explicitly routed calls.
 *
 * Meta creates a flow in DRAFT; only a publish makes it usable in a message.
 * So a create that succeeds and a publish that fails is NOT a partial
 * success — it is a failure that has left a DRAFT flow behind whose id we are
 * about to drop. Every such orphan is best-effort discarded before the
 * failure propagates, which is why publish failures are caught here rather
 * than left to the caller's catch.
 *
 * Validation errors are checked before publishing: Meta refuses to publish a
 * flow whose JSON failed validation, and reporting the actual validation
 * error is far more useful than the publish rejection it would cause.
 */
async function createAndPublish(
  client: WhatsAppClient,
  wabaId: string,
  phoneNumberId: string
): Promise<DeployContactFlowResult> {
  const created = await client.flows.create({
    wabaId,
    name: generateFlowName(),
    flowJson,
    publish: false,
  })

  if (created.validationErrors && created.validationErrors.length > 0) {
    await discardDraftFlow(client, created.id, phoneNumberId)
    return {
      ok: false,
      flowId: null,
      validationErrors: created.validationErrors,
      error: { title: 'flow_validation_error' },
    }
  }

  try {
    await client.flows.publish({ flowId: created.id, phoneNumberId })
  } catch (err) {
    await discardDraftFlow(client, created.id, phoneNumberId)
    throw err
  }

  return { ok: true, flowId: created.id }
}

/**
 * Best-effort removal of a flow that never made it past DRAFT.
 *
 * DELETE, not deprecate: Meta only deprecates PUBLISHED flows, and answers a
 * deprecate on a draft with "Deprecating attempt failed" — verified against
 * the live API, where the first cut of this cleanup silently left its drafts
 * behind. `DELETE /{flowId}` returns `{"success":true}` for a draft.
 *
 * Issued as a raw request because the SDK's `flows` resource has no `delete`
 * (create/updateAsset/publish/deprecate/preview/get/list/deploy only), and
 * carries the same `phone_number_id` routing every flow-scoped call needs.
 * Never throws — cleanup must not mask the failure that triggered it.
 */
async function discardDraftFlow(
  client: WhatsAppClient,
  flowId: string,
  phoneNumberId: string
): Promise<void> {
  try {
    const res = await client.request('DELETE', `/${flowId}`, {
      query: { phoneNumberId },
    })
    if (!res.ok) {
      console.warn(
        `[Kapso] Best-effort discard of unpublished contact flow ${flowId} returned ${res.status}`
      )
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn('[Kapso] Best-effort discard of unpublished contact flow failed:', message)
  }
}

/**
 * Best-effort deprecate of an orphaned flow at Meta — used by the deploy
 * path's concurrent-deploy guard (M1) when this call lost the race to
 * persist its flow id, and by `createAndPublish` when a created flow can
 * never be published. Never throws: a deprecate failure is logged and
 * swallowed, never fatal to the caller's own success/failure outcome.
 * (`scripts/deploy-contact-flow.ts`'s `--force` path has its own similar
 * best-effort deprecate for the previous flow — left as-is, out of scope
 * for this fix.)
 *
 * `phoneNumberId` is required for the same routing reason as publish: without
 * it Kapso 404s with "WhatsApp configuration not found" and the orphan stays
 * orphaned. See this file's module doc.
 */
export async function deprecateContactFlow(
  flowId: string,
  phoneNumberId: string
): Promise<void> {
  const client = getClient()
  if (!client) return

  try {
    await client.flows.deprecate({ flowId, phoneNumberId })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn('[Kapso] Best-effort deprecate of orphaned contact flow failed:', message)
  }
}

export interface DeployContactFlowFailure {
  error: string
  validationErrors?: FlowValidationError[]
}

/**
 * Single canonical mapping from a failed `DeployContactFlowResult` to a
 * structured failure (M2): validation errors ride as data on
 * `validationErrors`, never JSON-stringified into the error string. Shared
 * by `ensure-contact-flow-deployed.ts` and `scripts/deploy-contact-flow.ts`
 * so there is exactly one `describeDeployFailure`, not two same-named
 * functions with diverging return shapes.
 */
export function describeDeployFailure(result: DeployContactFlowResult): DeployContactFlowFailure {
  if (result.validationErrors && result.validationErrors.length > 0) {
    return { error: 'flow_validation_error', validationErrors: result.validationErrors }
  }
  return { error: result.error?.details ?? result.error?.title ?? 'flow_deploy_failed' }
}

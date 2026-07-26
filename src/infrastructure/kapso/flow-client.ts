// REPLY-007 (AD-3 step 3): deploys the committed contact-form Flow JSON to a
// tenant's WABA. Mirrors template-client.ts's `getClient()` / no-API-key-skip
// posture: missing config or any failure degrades to a Result, never throws.
//
// Deliberately calls `client.flows.deploy` WITHOUT the `flowId` option — the
// SDK's `deploy()` (node_modules/@kapso/whatsapp-cloud-api/dist/index.js)
// always CREATEs a new flow when `flowId` is omitted (no lookup-by-name), so
// each tenant WABA gets its own freshly created flow. Its `lastDeployedHashes`
// hash-cache is an in-memory per-process Map consulted only on the `flowId`
// update path — it cannot help across runs, so it plays no role here; the
// real idempotency guard is `getContactFlowIdStrict` in the caller (AD-3
// step 1).
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
// The SDK gives `flows.deploy` no way to pass an AbortSignal (it issues
// multiple sequential HTTP calls internally: create + optional publish), so
// the whole call is raced against a timer here instead — same lesson as the
// Resend adapter's `AbortSignal.timeout` fix, applied via our own race since
// no signal hook exists to plug into.
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
// bounds `flows.deploy` — the SDK has no timeout/AbortSignal support
// anywhere, so this race is the only way to cap a stalled Kapso round-trip.
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

export async function deployContactFlow(wabaId: string): Promise<DeployContactFlowResult> {
  const client = getClient()
  if (!client) {
    return { ok: false, flowId: null, error: { title: 'kapso_no_api_key' } }
  }

  try {
    const result = await withTimeout(
      client.flows.deploy(flowJson, { name: generateFlowName(), wabaId, publish: true }),
      DEPLOY_TIMEOUT_MS
    )

    if (result.validationErrors && result.validationErrors.length > 0) {
      return {
        ok: false,
        flowId: null,
        validationErrors: result.validationErrors,
        error: { title: 'flow_validation_error' },
      }
    }
    return { ok: true, flowId: result.flowId }
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
 * Best-effort deprecate of an orphaned flow at Meta — used by the deploy
 * path's concurrent-deploy guard (M1) when this call lost the race to
 * persist its flow id. Never throws: a deprecate failure is logged and
 * swallowed, never fatal to the caller's own success/failure outcome.
 * (`scripts/deploy-contact-flow.ts`'s `--force` path has its own similar
 * best-effort deprecate for the previous flow — left as-is, out of scope
 * for this fix.)
 */
export async function deprecateContactFlow(flowId: string): Promise<void> {
  const client = getClient()
  if (!client) return

  try {
    await client.flows.deprecate({ flowId })
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

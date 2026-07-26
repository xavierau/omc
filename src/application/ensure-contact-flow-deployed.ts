// REPLY-007 (AD-3): deploys the per-tenant contact-form WhatsApp Flow on
// demand. Layering mirrors create-whatsapp-template.ts — this use-case
// orchestrates the restaurant repository + kapso infra directly, no extra
// indirection.
//
// Never throws: the whole body runs inside a single try/catch so every
// failure — including a repo call that throws (e.g. restaurant not found) —
// surfaces as `{ ok: false, error }` instead of propagating. This is called
// synchronously from an admin save; a thrown error there must not fail the
// save transaction it is layered on top of.
//
// Result type, not `T | null`: a nullable return would collapse "already
// deployed", "can't resolve a WABA", and "Meta rejected the deploy" into one
// falsy value, which is exactly the failure mode the project's result-type
// principle exists to prevent.
//
// The whole use-case (WABA resolution + deploy), not just the deploy call,
// is bounded by `ENSURE_DEPLOYED_TIMEOUT_MS` (H1 review finding) — the
// idempotency read uses the strict repo read so a read failure can never be
// mistaken for "never deployed" (H2), and persisting the new flow id is
// conditional so two concurrent deploys can't both "win" (M1).

import {
  getContactFlowId,
  getContactFlowIdStrict,
  updateContactFlowIdIfEmpty,
  getMetaBusinessAccountId,
  getRestaurantPhoneNumberId,
  updateMetaBusinessAccountId,
} from '@/infrastructure/supabase/repositories/restaurant-repository'
import { resolveWabaId } from '@/infrastructure/kapso/template-client'
import {
  deployContactFlow,
  deprecateContactFlow,
  describeDeployFailure,
  withTimeout,
} from '@/infrastructure/kapso/flow-client'
import type { FlowValidationError } from '@kapso/whatsapp-cloud-api'

export type EnsureContactFlowDeployedResult =
  | { ok: true; flowId: string; created: boolean }
  | { ok: false; error: string; validationErrors?: FlowValidationError[] }

// Bounds the whole use-case (idempotency read + WABA resolution + deploy +
// persist) as one unit, not just the deploy call — `resolveWabaId`
// (template-client.ts) issues a raw `fetch` with no timeout anywhere in the
// SDK, so a stall there would otherwise hold the admin's
// `PATCH /api/dashboard/settings/contact-config` open indefinitely. Set
// above flow-client's own `DEPLOY_TIMEOUT_MS` (15s) so a normally-slow
// deploy that would have succeeded is never cut off by this outer bound.
export const ENSURE_DEPLOYED_TIMEOUT_MS = 20_000

export async function ensureContactFlowDeployed(
  restaurantId: string
): Promise<EnsureContactFlowDeployedResult> {
  try {
    return await withTimeout(runEnsureContactFlowDeployed(restaurantId), ENSURE_DEPLOYED_TIMEOUT_MS)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn('[ContactFlow] ensureContactFlowDeployed error:', message)
    return { ok: false, error: message }
  }
}

async function runEnsureContactFlowDeployed(
  restaurantId: string
): Promise<EnsureContactFlowDeployedResult> {
  // The real idempotency guard (AD-3 step 1): an already-deployed tenant
  // makes zero Meta calls. Strict read (H2): a query error, a pre-059
  // missing column, or a thrown client must fail closed as `ok:false` here
  // — never fall through to "never deployed", which would deploy a
  // brand-new Meta flow on every transient DB error.
  const existingFlowId = await getContactFlowIdStrict(restaurantId)
  if (existingFlowId) {
    return { ok: true, flowId: existingFlowId, created: false }
  }

  return deployNewFlow(restaurantId)
}

async function deployNewFlow(restaurantId: string): Promise<EnsureContactFlowDeployedResult> {
  const wabaId = await resolveWaba(restaurantId)
  if (!wabaId) {
    return { ok: false, error: 'contact_flow.no_waba_id' }
  }

  const deployResult = await deployContactFlow(wabaId)
  if (!deployResult.ok || !deployResult.flowId) {
    return { ok: false, ...describeDeployFailure(deployResult) }
  }

  return persistDeployedFlow(restaurantId, deployResult.flowId)
}

/**
 * M1: two concurrent form-mode saves (or a save racing the ops script) can
 * both read "no flow id" and both deploy at Meta. The persist is
 * conditional (`updateContactFlowIdIfEmpty`) so only one writer's id
 * sticks; the loser's flow is now an orphan at Meta and is best-effort
 * deprecated — a deprecate failure is logged, never fatal, and the caller
 * still gets back the flow id that actually won (re-read via the
 * webhook-safe getter, since by this point the row is known to hold one).
 */
async function persistDeployedFlow(
  restaurantId: string,
  flowId: string
): Promise<EnsureContactFlowDeployedResult> {
  const won = await updateContactFlowIdIfEmpty(restaurantId, flowId)
  if (won) {
    return { ok: true, flowId, created: true }
  }

  await deprecateContactFlow(flowId)
  const winningFlowId = await getContactFlowId(restaurantId)
  return { ok: true, flowId: winningFlowId ?? flowId, created: false }
}

/**
 * Derive-ONLY WABA resolution (AD-3 step 2, hardened per H3 review
 * finding). There is no safe fallback to a stored value here: `resolveWabaId`
 * returns `null` for BOTH "no phone number id" and "a transient Kapso /
 * network error", so a stored-value fallback can't tell "genuinely no WABA"
 * from "blip". Against a row poisoned by resubmit/route.ts's hardcoded
 * foreign WABA (kanban:1300, not fixed here), that ambiguity used to let one
 * transient blip silently deploy the tenant's flow into a foreign WABA while
 * reporting success. Failing closed when derivation comes up empty is the
 * only safe behavior: a tenant whose WABA can't be derived from their own
 * phone number has no working number, so a deployed flow would be useless
 * anyway.
 *
 * The derived value is persisted only when the stored one is empty (a
 * non-empty stored value is never overwritten); a derived/stored mismatch is
 * still warned — now unconditionally reachable whenever we have a derived
 * value at all, making a poisoned row a genuine, visible signal instead of a
 * silent cross-tenant deploy.
 *
 * Exported: this is the single copy of the algorithm. Callers that need the
 * WABA outside the ensure-deployed flow (e.g. scripts/deploy-contact-flow.ts's
 * --force path) must import and reuse this rather than re-deriving it — see
 * this file's module doc comment for why divergence here is a security
 * concern, not just duplication.
 */
export async function resolveWaba(restaurantId: string): Promise<string | null> {
  const phoneNumberId = await getRestaurantPhoneNumberId(restaurantId)
  const derived = await resolveWabaId(phoneNumberId)
  if (!derived) return null

  const stored = await getMetaBusinessAccountId(restaurantId)
  if (!stored) {
    await updateMetaBusinessAccountId(restaurantId, derived)
  } else if (stored !== derived) {
    console.warn('[ContactFlow] contact_flow.waba_mismatch', { restaurantId, derived, stored })
  }
  return derived
}

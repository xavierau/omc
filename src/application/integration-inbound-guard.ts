// INT-001 WI-2: `guardInboundRequest` implements steps 3-8 of the plan's
// §"Inbound auth v2" pipeline:
//   3. timestamp window (|now - t| <= 300s), auth-failure bucket on fail
//   4. signature validity (computed by the caller -- see verify-signature-v2.ts;
//      this module never touches a secret), auth-failure bucket on fail
//   5. integration.status !== 'active' -> 403 (T-M12: only reached once the
//      signature has already been judged valid, so status is never an
//      unauthenticated-enumeration channel)
//   6. INT001_DISABLE_INBOUND kill switch -> 503 feature_disabled
//   7. partner token bucket (default 60/min, burst 20) -> 429
//   8. nonce-replay dedup (T-H2) -> `replayed: true` in the decision
//
// Steps 1-2 (strict header parse, integration lookup, the constant-time
// dummy-secret check for an unknown id) live in verify-signature-v2.ts,
// which is also the only other caller of `chargeAuthFailureAndDecide`
// (shared here so both files charge and shape the SAME bucket the SAME way).
//
// `guardInboundRequest` returns a typed decision and never touches
// NextResponse -- and, structurally, never touches a database: it takes no
// db/repository parameter at all, so a Redis outage here can never race a
// DB write (T-H5's "zero DB writes on 503" is true by construction, not by
// convention).

import type { RateLimiterPort } from '@/domain/ports/rate-limiter'
import type { Clock } from '@/domain/ports/clock'

export const TIMESTAMP_TOLERANCE_SEC = 300
export const AUTH_FAILURE_LIMIT = 10
export const AUTH_FAILURE_WINDOW_SEC = 60
export const DEFAULT_PARTNER_RATE_PER_MIN = 60
export const DEFAULT_PARTNER_BURST = 20
export const REPLAY_WINDOW_SEC = 600

// I-1: a cheap, generous, integration-scoped gate the ROUTE checks BEFORE
// any Postgres read or body buffering -- see checkPreAuthThrottle below.
// Deliberately not the partner's configured rate limit (those settings
// live in the DB row this gate exists to avoid reading): a fixed, generous
// ceiling that only ever engages once genuinely flood-level traffic is
// hitting an integration's URL, unauthenticated or not.
export const PRE_AUTH_RATE_PER_MIN = 300
export const PRE_AUTH_BURST = 50

export interface GuardIntegration {
  id: string
  status: 'active' | 'inactive'
}

export interface GuardInboundRequestInput {
  integration: GuardIntegration
  /** X-OMC-Timestamp, already format-validated by the caller. */
  t: string
  /** X-OMC-Nonce, already format-validated by the caller. */
  nonce: string
  /** Result of verifying X-OMC-Signature against the (real or dummy)
   * secret -- computed by the caller, which owns the crypto and the secret
   * lookup; this module only branches on the boolean. */
  signatureValid: boolean
  rateLimiter: RateLimiterPort
  clock: Clock
  inboundDisabled: boolean
  limits?: { ratePerMin: number; burst: number }
}

export type GuardFailure =
  | { ok: false; status: 401; error: 'unauthorized' }
  | { ok: false; status: 403; error: 'integration_inactive' }
  | { ok: false; status: 429; error: 'rate_limited'; retryAfterSec: number; remaining: number }
  | { ok: false; status: 503; error: 'feature_disabled' | 'queue_unavailable' }

export type GuardSuccess = { ok: true; replayed: boolean }

export type GuardDecision = GuardSuccess | GuardFailure

// I-2: was `${integrationId}:${clientIp}`. `clientIp` came from
// audit-logger.ts's `extractIp`, which reads the FIRST hop off
// X-Forwarded-For -- behind an append-only proxy (nginx's
// `$proxy_add_x_forwarded_for`) that first hop is whatever the CLIENT
// sent, so an attacker mints a fresh one on every request and the 10/min
// limiter never trips. Keying on integrationId alone closes that: an
// unauthenticated caller cannot burn a PARTNER's own budget with this
// bucket regardless (that's `partnerBucketKey`, charged only after a
// valid signature), so sharing this bucket across every IP hitting one
// integration has no correctness cost.
export function authFailureBucketKey(integrationId: string): string {
  return `int001:rlf:${integrationId}`
}

export function partnerBucketKey(integrationId: string): string {
  return `int001:rl:${integrationId}`
}

export function nonceReplayKey(integrationId: string, nonce: string): string {
  return `int001:replay:${integrationId}:${nonce}`
}

export function preAuthBucketKey(integrationId: string): string {
  return `int001:preauth:${integrationId}`
}

export type PreAuthThrottleDecision =
  | { ok: true }
  | { ok: false; status: 429; error: 'rate_limited' }
  | { ok: false; status: 503; error: 'queue_unavailable' }

/**
 * I-1: the very first thing the route calls -- before `findIntegrationSettingsById`,
 * before `authenticateIntegrationV2` (itself another Postgres read), before
 * `request.text()` buffers the body. Keyed on `integrationId` alone (the
 * URL param, not a secret), so it needs no DB row and no signature to
 * compute. Fails CLOSED on a Redis outage (T-H5's posture): an outage must
 * not silently let an unbounded, uncounted flood through to the DB reads
 * this gate exists to protect.
 */
export async function checkPreAuthThrottle(
  rateLimiter: RateLimiterPort,
  integrationId: string
): Promise<PreAuthThrottleDecision> {
  try {
    const result = await rateLimiter.takeToken(preAuthBucketKey(integrationId), {
      ratePerMin: PRE_AUTH_RATE_PER_MIN,
      burst: PRE_AUTH_BURST,
    })
    if (!result.allowed) {
      return { ok: false, status: 429, error: 'rate_limited' }
    }
    return { ok: true }
  } catch {
    return { ok: false, status: 503, error: 'queue_unavailable' }
  }
}

/**
 * Charges the small, per-integration auth-failure bucket (I-2: no longer
 * per-clientIp -- see authFailureBucketKey's own header) and shapes the
 * resulting decision: 401 while the bucket has room, 429 once it's
 * exhausted (still without ever touching the partner's own bucket), or
 * 503 queue_unavailable if Redis itself is unreachable (T-H5: never fail
 * open -- an outage must not silently let unlimited unsigned traffic
 * through as bare 401s with no backpressure).
 *
 * Exported so verify-signature-v2.ts's steps 1-2 (malformed header, unknown
 * integration) charge and shape the identical bucket/response the same way
 * steps 3-4 here do.
 */
export async function chargeAuthFailureAndDecide(
  rateLimiter: RateLimiterPort,
  integrationId: string
): Promise<GuardFailure> {
  try {
    const { allowed } = await rateLimiter.incrWindow(
      authFailureBucketKey(integrationId),
      AUTH_FAILURE_LIMIT,
      AUTH_FAILURE_WINDOW_SEC
    )
    if (!allowed) {
      return { ok: false, status: 429, error: 'rate_limited', retryAfterSec: AUTH_FAILURE_WINDOW_SEC, remaining: 0 }
    }
    return { ok: false, status: 401, error: 'unauthorized' }
  } catch {
    return { ok: false, status: 503, error: 'queue_unavailable' }
  }
}

export async function guardInboundRequest(input: GuardInboundRequestInput): Promise<GuardDecision> {
  const nowSec = Math.floor(input.clock.now().getTime() / 1000)
  const tNum = Number(input.t)
  const withinWindow = Number.isFinite(tNum) && Math.abs(nowSec - tNum) <= TIMESTAMP_TOLERANCE_SEC

  // Steps 3 + 4: timestamp window and signature both gate on the SAME
  // auth-failure bucket / 401 shape -- neither leaks which one failed.
  if (!withinWindow || !input.signatureValid) {
    return chargeAuthFailureAndDecide(input.rateLimiter, input.integration.id)
  }

  // Step 5 (T-M12): status is only ever checked AFTER the signature has
  // been judged valid, and its failure never touches the auth-failure
  // bucket -- an authenticated partner finding out their own integration is
  // paused is not an attack signal.
  if (input.integration.status !== 'active') {
    return { ok: false, status: 403, error: 'integration_inactive' }
  }

  // Step 6: emergency kill switch, ahead of the partner's own rate limit.
  if (input.inboundDisabled) {
    return { ok: false, status: 503, error: 'feature_disabled' }
  }

  // Step 7: partner token bucket.
  const limits = input.limits ?? { ratePerMin: DEFAULT_PARTNER_RATE_PER_MIN, burst: DEFAULT_PARTNER_BURST }
  let bucket: { allowed: boolean; remaining: number; retryAfterSec: number }
  try {
    bucket = await input.rateLimiter.takeToken(partnerBucketKey(input.integration.id), limits)
  } catch {
    return { ok: false, status: 503, error: 'queue_unavailable' }
  }
  if (!bucket.allowed) {
    return {
      ok: false,
      status: 429,
      error: 'rate_limited',
      retryAfterSec: bucket.retryAfterSec,
      remaining: bucket.remaining,
    }
  }

  // Step 8 (T-H2): nonce-replay dedup. A byte-identical envelope (same
  // integration + nonce) presented again inside the window is flagged --
  // WI-3 decides how to react per endpoint. Note this is deliberately
  // separate from T-H3b's content-addressed idempotency record (same body,
  // possibly a DIFFERENT nonce): that mechanism already makes a legitimate
  // resubmission retry-safe regardless of nonce reuse, so this check's job
  // is narrower -- defence in depth against a captured signed envelope
  // being replayed, not response caching.
  let nonceCheck: { allowed: boolean; count: number }
  try {
    nonceCheck = await input.rateLimiter.incrWindow(
      nonceReplayKey(input.integration.id, input.nonce),
      1,
      REPLAY_WINDOW_SEC
    )
  } catch {
    return { ok: false, status: 503, error: 'queue_unavailable' }
  }

  return { ok: true, replayed: !nonceCheck.allowed }
}

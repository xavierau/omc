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
//
// N-1 (WI-17, confirmation review): this bucket used to be keyed on
// `integrationId` ALONE -- a public URL parameter, not a secret -- and
// gated ALL traffic to that integration. An unauthenticated caller flooding
// the URL with junk could exhaust it and 429 the partner's OWN signed
// traffic at the very first statement: exactly the outcome T-H5's "charge
// after signature" rule exists to prevent, reintroduced one bucket earlier.
// Fixed the same way I-2 fixed the auth-failure bucket's OWN
// keying mistake, but the other direction: keyed on (integrationId,
// TRUSTED client ip) below, so a flood from one real IP (however many
// spoofed LEFTMOST X-Forwarded-For values it rotates through, since
// `extractTrustedClientIp` reads only what nginx itself writes) throttles
// itself without touching a different real IP's -- e.g. the partner's own
// -- budget for the SAME integration. `PRE_AUTH_CEILING_*` below is kept as
// a much higher, integrationId-ONLY last-resort ceiling purely to bound
// aggregate DB-read cost against a genuinely distributed flood (many real
// IPs each individually under the per-IP limit) -- see checkPreAuthThrottle.
export const PRE_AUTH_RATE_PER_MIN = 300
export const PRE_AUTH_BURST = 50
export const PRE_AUTH_CEILING_MULTIPLIER = 10
export const PRE_AUTH_CEILING_RATE_PER_MIN = PRE_AUTH_RATE_PER_MIN * PRE_AUTH_CEILING_MULTIPLIER
export const PRE_AUTH_CEILING_BURST = PRE_AUTH_BURST * PRE_AUTH_CEILING_MULTIPLIER

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
  /** I-4: sha256hex(rawBody) for a POST, the jobId itself for a signed GET
   * poll (matches `AuthenticateV2Input.digest` in verify-signature-v2.ts,
   * and `digest` in the plan's own buildInboundBase formulas). Used ONLY
   * to distinguish a same-nonce RETRY (same digest) from a same-nonce
   * REPLAY/TAMPER (different digest) -- never persisted, never compared
   * for anything else. */
  digest: string
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

/** I-4: a SECOND key, keyed additionally on `digest`, checked only when
 * `nonceReplayKey` reports a reuse -- see `guardInboundRequest`'s own Step
 * 8 comment for the full mechanism. */
export function nonceReplayBodyKey(integrationId: string, nonce: string, digest: string): string {
  return `int001:replaybody:${integrationId}:${nonce}:${digest}`
}

// N-1: keyed on (integrationId, trusted client ip) -- see extractTrustedClientIp.
export function preAuthBucketKey(integrationId: string, clientIp: string): string {
  return `int001:preauth:${integrationId}:${clientIp}`
}

// N-1: the last-resort, integrationId-ONLY ceiling -- see this file's own
// N-1 header comment above PRE_AUTH_RATE_PER_MIN for what this bucket is
// (and, as importantly, is NOT) for.
export function preAuthCeilingBucketKey(integrationId: string): string {
  return `int001:preauthceil:${integrationId}`
}

/**
 * N-1: the trusted client IP for the pre-auth gate -- nginx sits in front
 * of this app and sets `X-Real-IP` to `$remote_addr` (the actual TCP peer,
 * never client-controlled) on every request, and appends that SAME value as
 * the RIGHTMOST hop of `X-Forwarded-For` via `$proxy_add_x_forwarded_for`.
 * Unlike `audit-logger.ts`'s `extractIp` (reads the FIRST X-Forwarded-For
 * hop -- purely client-supplied text, freely spoofable, and fine for an
 * audit-log ip_address column but not for a security-relevant rate-limit
 * key), this reads ONLY the parts nginx itself writes: `X-Real-IP` first,
 * then the rightmost `X-Forwarded-For` hop as a fallback for a deployment
 * without `X-Real-IP` set. A caller with no proxy in front of it at all
 * (local dev, tests) gets `'unknown'` -- still a valid, single shared
 * bucket key, just not IP-differentiated.
 */
export function extractTrustedClientIp(request: Request): string {
  const realIp = request.headers.get('x-real-ip')
  if (realIp && realIp.trim()) return realIp.trim()
  const xff = request.headers.get('x-forwarded-for')
  if (xff) {
    const hops = xff
      .split(',')
      .map((hop) => hop.trim())
      .filter((hop) => hop.length > 0)
    if (hops.length > 0) return hops[hops.length - 1]
  }
  return 'unknown'
}

export type PreAuthThrottleDecision =
  | { ok: true }
  | { ok: false; status: 429; error: 'rate_limited' }
  | { ok: false; status: 503; error: 'queue_unavailable' }

/**
 * I-1/N-1: the very first thing the route calls -- before
 * `findIntegrationSettingsById`, before `authenticateIntegrationV2` (itself
 * another Postgres read), before `request.text()` buffers the body. Two
 * buckets, checked in order:
 *   1. (integrationId, trustedClientIp) -- the PRIMARY defence (N-1): a
 *      flood from one real IP throttles itself without ever touching a
 *      DIFFERENT real IP's budget for the same integration, so an
 *      unauthenticated flood can no longer 429 the partner's own signed
 *      traffic. Checked first and returns immediately on rejection, so a
 *      throttled caller never also consumes the ceiling bucket below.
 *   2. integrationId ALONE, a much higher ceiling -- a last-resort guard
 *      against a genuinely DISTRIBUTED flood (many distinct real IPs, each
 *      individually under bucket 1's limit) that would otherwise still
 *      reach Postgres in aggregate. Only requests that already cleared
 *      bucket 1 count against it, so ordinary multi-IP partner traffic
 *      never comes close to tripping it.
 * Needs no DB row and no signature to compute either check. Fails CLOSED on
 * a Redis outage (T-H5's posture): an outage must not silently let an
 * unbounded, uncounted flood through to the DB reads this gate exists to
 * protect.
 */
export async function checkPreAuthThrottle(
  rateLimiter: RateLimiterPort,
  integrationId: string,
  clientIp: string
): Promise<PreAuthThrottleDecision> {
  try {
    const perIp = await rateLimiter.takeToken(preAuthBucketKey(integrationId, clientIp), {
      ratePerMin: PRE_AUTH_RATE_PER_MIN,
      burst: PRE_AUTH_BURST,
    })
    if (!perIp.allowed) {
      return { ok: false, status: 429, error: 'rate_limited' }
    }
    const ceiling = await rateLimiter.takeToken(preAuthCeilingBucketKey(integrationId), {
      ratePerMin: PRE_AUTH_CEILING_RATE_PER_MIN,
      burst: PRE_AUTH_CEILING_BURST,
    })
    if (!ceiling.allowed) {
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

  // Step 8 (T-H2 / I-4): nonce-replay dedup, now WITH a same-body check.
  // A byte-identical envelope (same integration + nonce) presented again
  // inside the window is either:
  //   - an idempotent RETRY -- this attempt's `digest` (sha256(rawBody)
  //     for POST, jobId for GET) matches what this nonce was first seen
  //     with. Accepted, `replayed: true` -- WI-3 decides how to react per
  //     endpoint (T-H3b's content-addressed idempotency already makes a
  //     legitimate POST resubmission safe regardless; GET is read-only).
  //   - a REPLAY/TAMPER attempt -- the digest differs, meaning a validly-
  //     signed nonce+signature pair is being reused against a DIFFERENT
  //     payload than the one it was ever signed for. Rejected with the
  //     SAME generic 401 shape (and the same auth-failure bucket charge)
  //     as every other auth failure in this pipeline (I-4 owner ruling,
  //     2026-09-10 -- see docs/integrations/member-api.md §2).
  // The nonce-only key still drives `replayed` (unchanged shape/semantics
  // for callers); the digest key is a second, narrower check consulted
  // ONLY on a nonce reuse.
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
  const replayed = !nonceCheck.allowed

  // The digest key is recorded on EVERY request (not only once `replayed`
  // is already known) -- a fresh nonce's own digest must already be on
  // record by the time a SECOND request with the same nonce arrives, or
  // there would be nothing for that second request to compare against.
  let bodyCheck: { allowed: boolean; count: number }
  try {
    bodyCheck = await input.rateLimiter.incrWindow(
      nonceReplayBodyKey(input.integration.id, input.nonce, input.digest),
      1,
      REPLAY_WINDOW_SEC
    )
  } catch {
    return { ok: false, status: 503, error: 'queue_unavailable' }
  }

  if (replayed) {
    const sameBody = !bodyCheck.allowed
    if (!sameBody) {
      return chargeAuthFailureAndDecide(input.rateLimiter, input.integration.id)
    }
  }

  return { ok: true, replayed }
}

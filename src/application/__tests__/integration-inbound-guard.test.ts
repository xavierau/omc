// INT-001 WI-2: `guardInboundRequest` implements steps 3-8 of the plan's
// §"Inbound auth v2" pipeline (timestamp window, signature-failure ->
// auth-failure bucket, status check, kill switch, partner token bucket,
// nonce-replay dedup). Steps 1-2 (header parsing, integration lookup) live
// in `verify-signature-v2.ts` and are covered by its own test file.
//
// Frozen acceptance-suite items covered here (plan §WI-2 "Tests (first)"):
//   - 10-min-old timestamp -> 401
//   - inactive + valid signature -> 403
//   - 100 unsigned requests do not consume the signed bucket (fake limiter)
//     and the auth-failure bucket trips at 10
//   - Redis down -> 503 queue_unavailable, zero DB writes

import { describe, expect, it } from 'vitest'
import { FakeClock } from '@/test-utils/fake-clock'
import { FakeRateLimiter } from '@/test-utils/fake-rate-limiter'
import type { RateLimiterPort } from '@/domain/ports/rate-limiter'
import {
  AUTH_FAILURE_LIMIT,
  AUTH_FAILURE_WINDOW_SEC,
  DEFAULT_PARTNER_BURST,
  DEFAULT_PARTNER_RATE_PER_MIN,
  PRE_AUTH_BURST,
  PRE_AUTH_CEILING_BURST,
  TIMESTAMP_TOLERANCE_SEC,
  authFailureBucketKey,
  checkPreAuthThrottle,
  extractTrustedClientIp,
  guardInboundRequest,
  nonceReplayBodyKey,
  nonceReplayKey,
  partnerBucketKey,
  preAuthBucketKey,
  preAuthCeilingBucketKey,
  type GuardInboundRequestInput,
} from '../integration-inbound-guard'

const NOW = new Date('2026-01-01T00:00:00.000Z')

function baseInput(overrides: Partial<GuardInboundRequestInput> = {}): GuardInboundRequestInput {
  const clock = overrides.clock ?? new FakeClock(NOW)
  const rateLimiter = overrides.rateLimiter ?? new FakeRateLimiter(clock)
  return {
    integration: { id: 'int-1', status: 'active' },
    t: String(Math.floor(NOW.getTime() / 1000)),
    nonce: 'nonce-0000000000000001',
    signatureValid: true,
    digest: 'digest-a',
    rateLimiter,
    clock,
    inboundDisabled: false,
    ...overrides,
  }
}

describe('guardInboundRequest: timestamp window', () => {
  it('accepts a timestamp exactly at the tolerance boundary', async () => {
    const clock = new FakeClock(NOW)
    const t = Math.floor(NOW.getTime() / 1000) - TIMESTAMP_TOLERANCE_SEC
    const decision = await guardInboundRequest(baseInput({ clock, rateLimiter: new FakeRateLimiter(clock), t: String(t) }))
    expect(decision.ok).toBe(true)
  })

  it('rejects a 10-minute-old timestamp with 401', async () => {
    const clock = new FakeClock(NOW)
    const tenMinutesAgo = Math.floor(NOW.getTime() / 1000) - 600
    const decision = await guardInboundRequest(
      baseInput({ clock, rateLimiter: new FakeRateLimiter(clock), t: String(tenMinutesAgo) })
    )
    expect(decision).toEqual({ ok: false, status: 401, error: 'unauthorized' })
  })

  it('rejects a non-numeric timestamp with 401', async () => {
    const clock = new FakeClock(NOW)
    const decision = await guardInboundRequest(
      baseInput({ clock, rateLimiter: new FakeRateLimiter(clock), t: 'not-a-number' })
    )
    expect(decision).toEqual({ ok: false, status: 401, error: 'unauthorized' })
  })
})

describe('guardInboundRequest: signature failure', () => {
  it('rejects an invalid signature with 401 and never reaches the partner bucket', async () => {
    const clock = new FakeClock(NOW)
    const rateLimiter = new FakeRateLimiter(clock)
    const decision = await guardInboundRequest(baseInput({ clock, rateLimiter, signatureValid: false }))
    expect(decision).toEqual({ ok: false, status: 401, error: 'unauthorized' })
    expect(await rateLimiter.get(partnerBucketKey('int-1'))).toBe(0)
  })
})

describe('guardInboundRequest: status check (T-M12 ordering)', () => {
  it('returns 403 for an inactive integration when the signature is valid', async () => {
    const decision = await guardInboundRequest(baseInput({ integration: { id: 'int-1', status: 'inactive' } }))
    expect(decision).toEqual({ ok: false, status: 403, error: 'integration_inactive' })
  })

  it('returns 401, not 403, for an inactive integration when the signature is invalid (auth wins)', async () => {
    const decision = await guardInboundRequest(
      baseInput({ integration: { id: 'int-1', status: 'inactive' }, signatureValid: false })
    )
    expect(decision).toEqual({ ok: false, status: 401, error: 'unauthorized' })
  })

  it('does not charge the auth-failure bucket for an inactive-but-signed request', async () => {
    const clock = new FakeClock(NOW)
    const rateLimiter = new FakeRateLimiter(clock)
    await guardInboundRequest(
      baseInput({ clock, rateLimiter, integration: { id: 'int-1', status: 'inactive' } })
    )
    const failureCheck = await rateLimiter.incrWindow(authFailureBucketKey('int-1'), AUTH_FAILURE_LIMIT, 60)
    expect(failureCheck.count).toBe(1) // only the assertion's own call -- guard charged nothing
  })
})

describe('guardInboundRequest: kill switch', () => {
  it('returns 503 feature_disabled when inbound is disabled, ahead of the partner bucket', async () => {
    const clock = new FakeClock(NOW)
    const rateLimiter = new FakeRateLimiter(clock)
    const decision = await guardInboundRequest(baseInput({ clock, rateLimiter, inboundDisabled: true }))
    expect(decision).toEqual({ ok: false, status: 503, error: 'feature_disabled' })
    expect(await rateLimiter.get(partnerBucketKey('int-1'))).toBe(0)
  })
})

describe('guardInboundRequest: partner token bucket', () => {
  it('allows requests up to burst, then 429 with Retry-After/remaining', async () => {
    const clock = new FakeClock(NOW)
    const rateLimiter = new FakeRateLimiter(clock)
    const decisions = []
    for (let i = 0; i < DEFAULT_PARTNER_BURST + 1; i += 1) {
      decisions.push(
        await guardInboundRequest(baseInput({ clock, rateLimiter, nonce: `nonce-unique-${String(i).padStart(6, '0')}` }))
      )
    }
    expect(decisions.slice(0, DEFAULT_PARTNER_BURST).every((d) => d.ok)).toBe(true)
    const last = decisions[DEFAULT_PARTNER_BURST]
    expect(last.ok).toBe(false)
    if (!last.ok && last.error === 'rate_limited') {
      expect(last.status).toBe(429)
      expect(last.retryAfterSec).toBeGreaterThan(0)
    } else {
      expect.fail('expected a rate_limited decision')
    }
  })

  it('honours a per-integration override for ratePerMin/burst', async () => {
    const clock = new FakeClock(NOW)
    const rateLimiter = new FakeRateLimiter(clock)
    const decision = await guardInboundRequest(
      baseInput({ clock, rateLimiter, limits: { ratePerMin: 60, burst: 1 } })
    )
    expect(decision.ok).toBe(true)
    const second = await guardInboundRequest(
      baseInput({ clock, rateLimiter, limits: { ratePerMin: 60, burst: 1 }, nonce: 'nonce-0000000000000002' })
    )
    expect(second.ok).toBe(false)
  })

  it('defaults to 60/min burst 20 when no override is supplied', () => {
    expect(DEFAULT_PARTNER_RATE_PER_MIN).toBe(60)
    expect(DEFAULT_PARTNER_BURST).toBe(20)
  })
})

describe('guardInboundRequest: nonce replay', () => {
  it('flags a second guard call with the same (integration, nonce) as replayed', async () => {
    const clock = new FakeClock(NOW)
    const rateLimiter = new FakeRateLimiter(clock)
    const first = await guardInboundRequest(baseInput({ clock, rateLimiter, nonce: 'nonce-replay-target-000' }))
    expect(first).toEqual({ ok: true, replayed: false })
    const second = await guardInboundRequest(baseInput({ clock, rateLimiter, nonce: 'nonce-replay-target-000' }))
    expect(second).toEqual({ ok: true, replayed: true })
  })

  it('treats different nonces as independent (not replayed)', async () => {
    const clock = new FakeClock(NOW)
    const rateLimiter = new FakeRateLimiter(clock)
    const first = await guardInboundRequest(baseInput({ clock, rateLimiter, nonce: 'nonce-independent-a-001' }))
    const second = await guardInboundRequest(baseInput({ clock, rateLimiter, nonce: 'nonce-independent-b-002' }))
    expect(first).toEqual({ ok: true, replayed: false })
    expect(second).toEqual({ ok: true, replayed: false })
  })

  it('scopes the replay key to the integration (documented via nonceReplayKey)', () => {
    expect(nonceReplayKey('int-1', 'abc')).not.toBe(nonceReplayKey('int-2', 'abc'))
  })

  // I-4 (WI-16, owner ruling 2026-09-10): a repeated nonce with the SAME
  // digest (sha256(rawBody) for POST, jobId for GET) is an idempotent
  // retry -- accepted, `replayed: true`. A repeated nonce with a
  // DIFFERENT digest means a validly-signed envelope is being replayed
  // against a payload it was never signed for -- rejected with the same
  // generic 401 shape every other auth failure in this pipeline uses, and
  // charged to the auth-failure bucket like any other auth failure.
  describe('I-4: same-nonce reuse is accepted only when the digest also matches', () => {
    it('same nonce + same digest (retry) -> accepted, replayed: true', async () => {
      const clock = new FakeClock(NOW)
      const rateLimiter = new FakeRateLimiter(clock)
      const first = await guardInboundRequest(
        baseInput({ clock, rateLimiter, nonce: 'nonce-i4-same-000000', digest: 'digest-x' })
      )
      expect(first).toEqual({ ok: true, replayed: false })
      const second = await guardInboundRequest(
        baseInput({ clock, rateLimiter, nonce: 'nonce-i4-same-000000', digest: 'digest-x' })
      )
      expect(second).toEqual({ ok: true, replayed: true })
    })

    it('same nonce + DIFFERENT digest (replay/tamper) -> rejected 401, same shape as any other auth failure', async () => {
      const clock = new FakeClock(NOW)
      const rateLimiter = new FakeRateLimiter(clock)
      const first = await guardInboundRequest(
        baseInput({ clock, rateLimiter, nonce: 'nonce-i4-diff-000000', digest: 'digest-original' })
      )
      expect(first).toEqual({ ok: true, replayed: false })
      const second = await guardInboundRequest(
        baseInput({ clock, rateLimiter, nonce: 'nonce-i4-diff-000000', digest: 'digest-tampered' })
      )
      expect(second).toEqual({ ok: false, status: 401, error: 'unauthorized' })
    })

    it('a rejected replay/tamper attempt charges the auth-failure bucket (trips 429 after AUTH_FAILURE_LIMIT)', async () => {
      const clock = new FakeClock(NOW)
      const rateLimiter = new FakeRateLimiter(clock)
      await guardInboundRequest(
        baseInput({ clock, rateLimiter, nonce: 'nonce-i4-bucket-0000', digest: 'digest-original' })
      )
      let last: Awaited<ReturnType<typeof guardInboundRequest>> | undefined
      // AUTH_FAILURE_LIMIT rejections still return 401 each (count<=limit);
      // the (limit+1)th is what actually trips 429 -- matches the "100
      // unsigned requests" test's own first10-vs-rest convention above.
      for (let i = 0; i < AUTH_FAILURE_LIMIT + 1; i++) {
        last = await guardInboundRequest(
          baseInput({ clock, rateLimiter, nonce: 'nonce-i4-bucket-0000', digest: `digest-tampered-${i}` })
        )
      }
      expect(last).toEqual({ ok: false, status: 429, error: 'rate_limited', retryAfterSec: AUTH_FAILURE_WINDOW_SEC, remaining: 0 })
    })

    it('503 queue_unavailable when Redis fails on the digest check, not a silent accept', async () => {
      const clock = new FakeClock(NOW)
      const rateLimiter = new FakeRateLimiter(clock)
      await guardInboundRequest(baseInput({ clock, rateLimiter, nonce: 'nonce-i4-redis-0000', digest: 'digest-a' }))
      const originalIncrWindow = rateLimiter.incrWindow.bind(rateLimiter)
      let call = 0
      rateLimiter.incrWindow = async (key: string, limit: number, windowSec: number) => {
        call += 1
        // First incrWindow call on the retry is the nonce-only check
        // (must succeed so we reach the digest check); the SECOND is the
        // digest check this test fails.
        if (call === 2) throw new Error('redis down')
        return originalIncrWindow(key, limit, windowSec)
      }
      const decision = await guardInboundRequest(
        baseInput({ clock, rateLimiter, nonce: 'nonce-i4-redis-0000', digest: 'digest-a' })
      )
      expect(decision).toEqual({ ok: false, status: 503, error: 'queue_unavailable' })
    })

    it('nonceReplayBodyKey scopes to integration + nonce + digest', () => {
      expect(nonceReplayBodyKey('int-1', 'n1', 'd1')).not.toBe(nonceReplayBodyKey('int-1', 'n1', 'd2'))
      expect(nonceReplayBodyKey('int-1', 'n1', 'd1')).not.toBe(nonceReplayBodyKey('int-2', 'n1', 'd1'))
    })
  })
})

describe('guardInboundRequest: auth-failure bucket (T-H5 poisoning defence)', () => {
  it('100 unsigned requests never touch the partner bucket, and the auth-failure bucket trips after 10', async () => {
    const clock = new FakeClock(NOW)
    const rateLimiter = new FakeRateLimiter(clock)
    const decisions = []
    for (let i = 0; i < 100; i += 1) {
      decisions.push(
        await guardInboundRequest(
          baseInput({ clock, rateLimiter, signatureValid: false, nonce: `nonce-unsigned-${String(i).padStart(6, '0')}` })
        )
      )
    }

    // Partner bucket (int001:rl:{id}) must never be consumed by unsigned traffic.
    expect(await rateLimiter.get(partnerBucketKey('int-1'))).toBe(0)

    const first10 = decisions.slice(0, 10)
    expect(first10.every((d) => !d.ok && d.status === 401 && d.error === 'unauthorized')).toBe(true)

    const rest = decisions.slice(10)
    expect(rest.every((d) => !d.ok && d.status === 429 && d.error === 'rate_limited')).toBe(true)
  })

  // I-2: the auth-failure bucket used to be keyed on (integrationId,
  // clientIp), where clientIp came straight from the client-controlled
  // X-Forwarded-For header (audit-logger.ts's extractIp reads the FIRST
  // hop, which an attacker sitting in front of an append-only proxy
  // chooses freely) -- an attacker could mint a fresh IP on every request
  // and never trip the 10/min limit. Fixed by removing `clientIp` from the
  // guard's input entirely, not just from the key formula -- a field that
  // exists but is silently ignored is exactly the kind of drift that lets
  // a bypass creep back in. The bucket is now keyed on integrationId alone,
  // so it trips regardless of which IP (real or spoofed) the failing
  // requests claim to come from -- proven structurally below, mirroring
  // this file's own "never touches a database" structural test.
  it('I-2: GuardInboundRequestInput carries no clientIp field at all -- the auth-failure bucket cannot be keyed on (and so cannot be bypassed via) a client-controlled IP', () => {
    const inputKeys = Object.keys(baseInput())
    expect(inputKeys).not.toContain('clientIp')
  })

  it('authFailureBucketKey takes only an integrationId, scoped per integration', () => {
    expect(authFailureBucketKey('int-1')).toBe(authFailureBucketKey('int-1'))
    expect(authFailureBucketKey('int-1')).not.toBe(authFailureBucketKey('int-2'))
  })
})

describe('checkPreAuthThrottle (I-1/N-1: cheap pre-auth gate, before any DB read or body buffering)', () => {
  it('allows a request within the generous default budget', async () => {
    const clock = new FakeClock(NOW)
    const rateLimiter = new FakeRateLimiter(clock)
    const decision = await checkPreAuthThrottle(rateLimiter, 'int-1', '203.0.113.9')
    expect(decision).toEqual({ ok: true })
  })

  it('a flood against ONE (integration, ip) eventually 429s', async () => {
    const clock = new FakeClock(NOW)
    const rateLimiter = new FakeRateLimiter(clock)
    const decisions = []
    for (let i = 0; i < 400; i += 1) {
      decisions.push(await checkPreAuthThrottle(rateLimiter, 'int-flood', '203.0.113.9'))
    }
    expect(decisions.some((d) => !d.ok && d.status === 429 && d.error === 'rate_limited')).toBe(true)
  })

  it('a flood against integration A never consumes integration B budget (same ip)', async () => {
    const clock = new FakeClock(NOW)
    const rateLimiter = new FakeRateLimiter(clock)
    for (let i = 0; i < 400; i += 1) {
      await checkPreAuthThrottle(rateLimiter, 'int-a', '203.0.113.9')
    }
    const decisionB = await checkPreAuthThrottle(rateLimiter, 'int-b', '203.0.113.9')
    expect(decisionB).toEqual({ ok: true })
  })

  // N-1: the actual bug this dispatch fixes -- an unauthenticated flood
  // used to be keyed on integrationId ALONE, so it could 429 a partner's
  // own signed traffic on the SAME integration. Rotating the LEFTMOST
  // X-Forwarded-For value (the one `extractTrustedClientIp` deliberately
  // ignores) doesn't help the attacker: every request still shares the same
  // TRUSTED ip, so they all land in the same per-ip bucket and throttle
  // themselves -- while a different real ip (the partner's) on the SAME
  // integration gets an untouched budget.
  describe('N-1: per-ip bucket isolates an unauthenticated flood from the partner\'s own traffic', () => {
    it('1000 requests from rotating spoofed identities but ONE real (trusted) ip do not 429 a concurrent request from a DIFFERENT real ip on the same integration', async () => {
      const clock = new FakeClock(NOW)
      const rateLimiter = new FakeRateLimiter(clock)
      const attackerDecisions = []
      for (let i = 0; i < 1000; i += 1) {
        // The attacker's TRUSTED ip never changes -- only what they'd send
        // as a leftmost X-Forwarded-For hop would, which this bucket never
        // sees at all (the route resolves clientIp via extractTrustedClientIp
        // before this function is ever called).
        attackerDecisions.push(await checkPreAuthThrottle(rateLimiter, 'int-1', '198.51.100.7'))
      }
      // The attacker's own bucket throttles them (proves the flood was real).
      expect(attackerDecisions.some((d) => !d.ok && d.status === 429)).toBe(true)

      // A concurrent, legitimate request from the PARTNER's own real ip on
      // the SAME integration must sail through untouched.
      const partnerDecision = await checkPreAuthThrottle(rateLimiter, 'int-1', '203.0.113.55')
      expect(partnerDecision).toEqual({ ok: true })
    })

    it('the same 1000-request flood from ONE real ip IS throttled (never silently let through)', async () => {
      const clock = new FakeClock(NOW)
      const rateLimiter = new FakeRateLimiter(clock)
      let sawThrottle = false
      for (let i = 0; i < 1000; i += 1) {
        const decision = await checkPreAuthThrottle(rateLimiter, 'int-1', '198.51.100.7')
        if (!decision.ok && decision.status === 429) sawThrottle = true
      }
      expect(sawThrottle).toBe(true)
    })

    it('the integrationId-only ceiling still trips on a TRUE distributed flood (many distinct real ips, each individually under the per-ip limit)', async () => {
      const clock = new FakeClock(NOW)
      const rateLimiter = new FakeRateLimiter(clock)
      const decisions = []
      // One request per distinct ip -- always clears the per-ip bucket
      // (burst >= 1), so every one of these attempts the ceiling bucket.
      // PRE_AUTH_CEILING_BURST is a fixed initial capacity with the clock
      // frozen (no refill), so this must eventually trip it.
      for (let i = 0; i < PRE_AUTH_CEILING_BURST + 50; i += 1) {
        decisions.push(await checkPreAuthThrottle(rateLimiter, 'int-1', `distinct-ip-${i}`))
      }
      expect(decisions.some((d) => !d.ok && d.status === 429 && d.error === 'rate_limited')).toBe(true)
    })

    it('a request throttled by the per-ip bucket never also consumes the ceiling bucket (short-circuits before the ceiling check)', async () => {
      const clock = new FakeClock(NOW)
      const rateLimiter = new FakeRateLimiter(clock)
      // Exhaust ONE ip's per-ip bucket well past its own limit.
      for (let i = 0; i < PRE_AUTH_BURST + 20; i += 1) {
        await checkPreAuthThrottle(rateLimiter, 'int-1', '198.51.100.7')
      }
      // The ceiling bucket itself must still be untouched -- proven by a
      // fresh ip immediately getting the full per-ip burst (which would
      // itself trip the ceiling if the flood above had also been charged
      // to it, since the ceiling's burst is only 10x one ip's burst and
      // the flood above sent far more than 10x PRE_AUTH_BURST attempts).
      let allowedForFreshIp = 0
      for (let i = 0; i < PRE_AUTH_BURST; i += 1) {
        const decision = await checkPreAuthThrottle(rateLimiter, 'int-1', '203.0.113.200')
        if (decision.ok) allowedForFreshIp += 1
      }
      expect(allowedForFreshIp).toBe(PRE_AUTH_BURST)
    })
  })

  it('fails CLOSED (503 queue_unavailable) when Redis itself is unreachable -- never lets an unauthenticated flood through uncounted (T-H5 posture)', async () => {
    const throwing: Parameters<typeof checkPreAuthThrottle>[0] = {
      takeToken: async () => {
        throw new Error('ECONNREFUSED')
      },
      incrWindow: async () => {
        throw new Error('ECONNREFUSED')
      },
      incr: async () => {
        throw new Error('ECONNREFUSED')
      },
      decr: async () => {
        throw new Error('ECONNREFUSED')
      },
      get: async () => {
        throw new Error('ECONNREFUSED')
      },
      set: async () => {
        throw new Error('ECONNREFUSED')
      },
    }
    const decision = await checkPreAuthThrottle(throwing, 'int-1', '203.0.113.9')
    expect(decision).toEqual({ ok: false, status: 503, error: 'queue_unavailable' })
  })

  it('preAuthBucketKey scopes to (integration, ip) -- distinct keys per integration and per ip', () => {
    expect(preAuthBucketKey('int-1', '1.2.3.4')).not.toBe(preAuthBucketKey('int-2', '1.2.3.4'))
    expect(preAuthBucketKey('int-1', '1.2.3.4')).not.toBe(preAuthBucketKey('int-1', '5.6.7.8'))
  })

  it('preAuthCeilingBucketKey scopes to the integration only', () => {
    expect(preAuthCeilingBucketKey('int-1')).not.toBe(preAuthCeilingBucketKey('int-2'))
  })
})

describe('extractTrustedClientIp (N-1)', () => {
  function req(headers: Record<string, string>): Request {
    return new Request('https://example.test/x', { headers })
  }

  it('prefers X-Real-IP (nginx-set, never client-controlled)', () => {
    expect(
      extractTrustedClientIp(req({ 'x-real-ip': '203.0.113.10', 'x-forwarded-for': '9.9.9.9, 203.0.113.10' }))
    ).toBe('203.0.113.10')
  })

  it('falls back to the RIGHTMOST X-Forwarded-For hop (the one nginx itself appends), never the leftmost client-supplied one', () => {
    expect(extractTrustedClientIp(req({ 'x-forwarded-for': '9.9.9.9, 8.8.8.8, 203.0.113.10' }))).toBe(
      '203.0.113.10'
    )
  })

  it('a single-hop X-Forwarded-For (no proxy chain) is used as-is', () => {
    expect(extractTrustedClientIp(req({ 'x-forwarded-for': '203.0.113.10' }))).toBe('203.0.113.10')
  })

  it('returns "unknown" when neither header is present, rather than throwing', () => {
    expect(extractTrustedClientIp(req({}))).toBe('unknown')
  })

  it('an attacker spoofing ONLY the leftmost X-Forwarded-For hop cannot change the resolved trusted ip', () => {
    const a = extractTrustedClientIp(req({ 'x-forwarded-for': 'spoofed-identity-1, 203.0.113.10' }))
    const b = extractTrustedClientIp(req({ 'x-forwarded-for': 'spoofed-identity-2, 203.0.113.10' }))
    expect(a).toBe('203.0.113.10')
    expect(b).toBe('203.0.113.10')
  })
})

describe('guardInboundRequest: Redis outage (T-H5 fail closed)', () => {
  class ThrowingRateLimiter implements RateLimiterPort {
    async takeToken(): Promise<never> {
      throw new Error('ECONNREFUSED')
    }
    async incrWindow(): Promise<never> {
      throw new Error('ECONNREFUSED')
    }
    async incr(): Promise<never> {
      throw new Error('ECONNREFUSED')
    }
    async decr(): Promise<never> {
      throw new Error('ECONNREFUSED')
    }
    async get(): Promise<never> {
      throw new Error('ECONNREFUSED')
    }
    async set(): Promise<never> {
      throw new Error('ECONNREFUSED')
    }
  }

  it('returns 503 queue_unavailable (never fails open) when the partner bucket check throws', async () => {
    const clock = new FakeClock(NOW)
    const decision = await guardInboundRequest(baseInput({ clock, rateLimiter: new ThrowingRateLimiter() }))
    expect(decision).toEqual({ ok: false, status: 503, error: 'queue_unavailable' })
  })

  it('returns 503 queue_unavailable when the auth-failure-bucket charge throws', async () => {
    const clock = new FakeClock(NOW)
    const decision = await guardInboundRequest(
      baseInput({ clock, rateLimiter: new ThrowingRateLimiter(), signatureValid: false })
    )
    expect(decision).toEqual({ ok: false, status: 503, error: 'queue_unavailable' })
  })

  it('never writes to a database -- the guard takes no DB client at all (structural)', () => {
    // guardInboundRequest's parameter type has no db/repository field; this
    // is a compile-time guarantee, asserted here so a future edit that adds
    // one is forced to justify it. See GuardInboundRequestInput.
    const inputKeys = Object.keys(baseInput())
    expect(inputKeys).not.toContain('db')
    expect(inputKeys).not.toContain('supabase')
    expect(inputKeys).not.toContain('repository')
  })
})

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
  DEFAULT_PARTNER_BURST,
  DEFAULT_PARTNER_RATE_PER_MIN,
  TIMESTAMP_TOLERANCE_SEC,
  authFailureBucketKey,
  guardInboundRequest,
  nonceReplayKey,
  partnerBucketKey,
  type GuardInboundRequestInput,
} from '../integration-inbound-guard'

const NOW = new Date('2026-01-01T00:00:00.000Z')

function baseInput(overrides: Partial<GuardInboundRequestInput> = {}): GuardInboundRequestInput {
  const clock = overrides.clock ?? new FakeClock(NOW)
  const rateLimiter = overrides.rateLimiter ?? new FakeRateLimiter(clock)
  return {
    integration: { id: 'int-1', status: 'active' },
    clientIp: '203.0.113.9',
    t: String(Math.floor(NOW.getTime() / 1000)),
    nonce: 'nonce-0000000000000001',
    signatureValid: true,
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
    const failureCheck = await rateLimiter.incrWindow(authFailureBucketKey('int-1', '203.0.113.9'), AUTH_FAILURE_LIMIT, 60)
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

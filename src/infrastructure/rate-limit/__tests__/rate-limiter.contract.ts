// Shared contract suite for `RateLimiterPort`. Runs against the fake
// (FakeRateLimiter, WI-1) always; WI-2 adds a second invocation against the
// real RedisRateLimiter, gated on `INT001_TEST_REDIS_URL` (integration
// lane), per plan §"Ports with fake + real adapters".
//
// Does NOT end in `.test.ts` -- see `rate-limiter.test.ts` for the invocation.

import { describe, expect, it } from 'vitest'
import type { RateLimiterPort } from '@/domain/ports/rate-limiter'

export function runRateLimiterContract(
  label: string,
  createLimiter: () => RateLimiterPort | Promise<RateLimiterPort>
): void {
  describe(`RateLimiterPort contract (${label})`, () => {
    it('takeToken allows up to `burst` requests then denies', async () => {
      const limiter = await createLimiter()
      const key = `contract-bucket-${Math.random().toString(36).slice(2)}`
      const opts = { ratePerMin: 60, burst: 3 }
      const results = []
      for (let i = 0; i < 4; i += 1) {
        results.push(await limiter.takeToken(key, opts))
      }
      expect(results.slice(0, 3).every((r) => r.allowed)).toBe(true)
      expect(results[3].allowed).toBe(false)
      expect(results[3].retryAfterSec).toBeGreaterThan(0)
    })

    it('incrWindow allows up to `limit` then denies within the window', async () => {
      const limiter = await createLimiter()
      const key = `contract-window-${Math.random().toString(36).slice(2)}`
      const results = []
      for (let i = 0; i < 4; i += 1) {
        results.push(await limiter.incrWindow(key, 3, 60))
      }
      expect(results.slice(0, 3).every((r) => r.allowed)).toBe(true)
      expect(results[3].allowed).toBe(false)
      expect(results[3].count).toBe(4)
    })

    it('incr/decr/get behave as a plain counter', async () => {
      const limiter = await createLimiter()
      const key = `contract-counter-${Math.random().toString(36).slice(2)}`
      expect(await limiter.get(key)).toBe(0)
      expect(await limiter.incr(key)).toBe(1)
      expect(await limiter.incr(key)).toBe(2)
      expect(await limiter.decr(key)).toBe(1)
      expect(await limiter.get(key)).toBe(1)
    })

    it('different keys have independent state', async () => {
      const limiter = await createLimiter()
      const keyA = `contract-independent-a-${Math.random().toString(36).slice(2)}`
      const keyB = `contract-independent-b-${Math.random().toString(36).slice(2)}`
      await limiter.incr(keyA)
      expect(await limiter.get(keyB)).toBe(0)
    })
  })
}

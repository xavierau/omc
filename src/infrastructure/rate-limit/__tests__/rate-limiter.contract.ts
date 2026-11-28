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

    // WI-11 fix: the real adapter's incrWindow() runs a bare Redis INCR
    // against `key` (redis-rate-limiter.ts's INCR_WINDOW_SCRIPT), the exact
    // same key namespace incr()/decr()/get() read and write -- so get() and
    // incr() see whatever incrWindow() last wrote, and vice versa. WI-4's
    // handoff flagged that the fake did not honour this: it stored
    // incrWindow()'s count in a Map separate from the one get()/incr()/decr()
    // read, so get() after incrWindow() silently returned 0. This case pins
    // the real adapter's actual behaviour so both adapters agree.
    it('get() reflects the count written by incrWindow() on the same key', async () => {
      const limiter = await createLimiter()
      const key = `contract-window-read-${Math.random().toString(36).slice(2)}`
      const first = await limiter.incrWindow(key, 10, 60)
      expect(first.count).toBe(1)
      expect(await limiter.get(key)).toBe(1)

      const second = await limiter.incrWindow(key, 10, 60)
      expect(second.count).toBe(2)
      expect(await limiter.get(key)).toBe(2)
    })

    it('incrWindow() and incr() on the same key share one counter', async () => {
      const limiter = await createLimiter()
      const key = `contract-window-incr-mix-${Math.random().toString(36).slice(2)}`
      await limiter.incrWindow(key, 10, 60)
      expect(await limiter.incr(key)).toBe(2)
      const third = await limiter.incrWindow(key, 10, 60)
      expect(third.count).toBe(3)
    })

    // WI-13 (Gap B): set() is the depth-counter reconciliation sweep's only
    // write primitive -- it must overwrite unconditionally (not add a
    // delta), whether correcting the counter UP or DOWN, and whether a
    // prior value existed or not.
    it('set() overwrites the counter to an absolute value, read back by get()', async () => {
      const limiter = await createLimiter()
      const key = `contract-set-${Math.random().toString(36).slice(2)}`
      await limiter.set(key, 7)
      expect(await limiter.get(key)).toBe(7)

      await limiter.set(key, 2)
      expect(await limiter.get(key)).toBe(2)

      await limiter.set(key, 0)
      expect(await limiter.get(key)).toBe(0)
    })

    it('set() on a key incr/decr already touched is read consistently by incr/decr', async () => {
      const limiter = await createLimiter()
      const key = `contract-set-then-incr-${Math.random().toString(36).slice(2)}`
      await limiter.incr(key)
      await limiter.set(key, 10)
      expect(await limiter.incr(key)).toBe(11)
    })
  })
}

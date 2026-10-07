// INT-001 WI-2: RedisRateLimiter is the real adapter for RateLimiterPort
// (WI-1 port + FakeRateLimiter + rate-limiter.contract.ts). The shared
// contract's real-adapter invocation lives in rate-limiter.test.ts per
// WI-1's placeholder comment; this file covers the two things the generic
// contract can't: state sharing ACROSS instances (proving the limit holds
// across Node processes, per T-H5) and fail-fast behaviour when Redis is
// unreachable (T-H5 "never fail open").
//
// Gated on INT001_TEST_REDIS_URL (integration lane) -- skipped entirely in
// CI, matching every other real-adapter lane in this plan (WI-1's Redis/
// scratch-DB precedent).

import { describe, expect, it } from 'vitest'
import Redis from 'ioredis'
import { RedisRateLimiter } from '../redis-rate-limiter'
import { getFailFastRedisOptions } from '@/infrastructure/redis/connection'

const REDIS_URL = process.env.INT001_TEST_REDIS_URL
const describeIfRedis = REDIS_URL ? describe : describe.skip

describeIfRedis('RedisRateLimiter (real Redis, integration lane)', () => {
  function newLimiter(): { limiter: RedisRateLimiter; client: Redis } {
    const client = new Redis(REDIS_URL as string)
    return { limiter: new RedisRateLimiter(client), client }
  }

  it('two independently-constructed instances share bucket state', async () => {
    const a = newLimiter()
    const b = newLimiter()
    const key = `test:shared-bucket:${Math.random().toString(36).slice(2)}`
    try {
      const opts = { ratePerMin: 60, burst: 3 }
      const r1 = await a.limiter.takeToken(key, opts)
      const r2 = await b.limiter.takeToken(key, opts)
      const r3 = await a.limiter.takeToken(key, opts)
      const r4 = await b.limiter.takeToken(key, opts)
      expect([r1, r2, r3].every((r) => r.allowed)).toBe(true)
      expect(r4.allowed).toBe(false) // 4th consumption across BOTH instances, burst=3
    } finally {
      await a.client.del(key)
      await a.client.quit()
      await b.client.quit()
    }
  })

  it('two independently-constructed instances share fixed-window counter state', async () => {
    const a = newLimiter()
    const b = newLimiter()
    const key = `test:shared-window:${Math.random().toString(36).slice(2)}`
    try {
      const r1 = await a.limiter.incrWindow(key, 2, 60)
      const r2 = await b.limiter.incrWindow(key, 2, 60)
      const r3 = await a.limiter.incrWindow(key, 2, 60)
      expect(r1.allowed).toBe(true)
      expect(r2.allowed).toBe(true)
      expect(r3.allowed).toBe(false)
      expect(r3.count).toBe(3)
    } finally {
      await a.client.del(key)
      await a.client.quit()
      await b.client.quit()
    }
  })

  it('expires the token bucket key so an idle bucket does not leak memory forever', async () => {
    const a = newLimiter()
    const key = `test:ttl-bucket:${Math.random().toString(36).slice(2)}`
    try {
      await a.limiter.takeToken(key, { ratePerMin: 60, burst: 3 })
      const ttl = await a.client.ttl(key)
      expect(ttl).toBeGreaterThan(0)
    } finally {
      await a.client.del(key)
      await a.client.quit()
    }
  })
})

describe('RedisRateLimiter: unreachable Redis (T-H5 fail closed)', () => {
  it('rejects quickly instead of hanging when Redis cannot be reached', async () => {
    // Port 1 is a reserved/unassigned port -- connection is refused fast.
    const client = new Redis({
      ...getFailFastRedisOptions(),
      host: '127.0.0.1',
      port: 1,
      retryStrategy: () => null,
    })
    client.on('error', () => {
      // ioredis emits 'error' on every failed connection attempt; without a
      // listener Node treats it as an uncaught exception and crashes the
      // test worker. Swallow here -- we assert on the rejected promise.
    })
    const limiter = new RedisRateLimiter(client)
    try {
      await expect(limiter.takeToken('unreachable-key', { ratePerMin: 60, burst: 3 })).rejects.toBeInstanceOf(Error)
    } finally {
      client.disconnect()
    }
  }, 8000)
})

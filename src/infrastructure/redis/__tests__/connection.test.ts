import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getFailFastRedisOptions, parseRedisUrl, redisUrl } from '../connection'

describe('parseRedisUrl', () => {
  it('parses host, port, password, username and db from a full URL', () => {
    const opts = parseRedisUrl('redis://user:pass@example.com:6380/2')
    expect(opts.host).toBe('example.com')
    expect(opts.port).toBe(6380)
    expect(opts.password).toBe('pass')
    expect(opts.username).toBe('user')
    expect(opts.db).toBe(2)
  })

  it('defaults host/port and omits password/username/db when absent', () => {
    const opts = parseRedisUrl('redis://localhost:6379')
    expect(opts.host).toBe('localhost')
    expect(opts.port).toBe(6379)
    expect(opts.password).toBeUndefined()
    expect(opts.username).toBeUndefined()
    expect(opts.db).toBeUndefined()
  })
})

describe('redisUrl', () => {
  const ORIGINAL = process.env.REDIS_URL

  beforeEach(() => {
    delete process.env.REDIS_URL
  })

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.REDIS_URL
    else process.env.REDIS_URL = ORIGINAL
  })

  it('defaults to redis://localhost:6379 when REDIS_URL is unset', () => {
    expect(redisUrl()).toBe('redis://localhost:6379')
  })

  it('reads REDIS_URL when set', () => {
    process.env.REDIS_URL = 'redis://example.com:6390'
    expect(redisUrl()).toBe('redis://example.com:6390')
  })
})

describe('getFailFastRedisOptions', () => {
  // T-H5: "never fail open" -- the rate limiter's Redis client must reject
  // fast on an outage rather than silently queueing commands or hanging
  // forever waiting for a reconnect.
  it('disables the offline queue, bounds retries and connect timeout', () => {
    const opts = getFailFastRedisOptions()
    expect(opts.enableOfflineQueue).toBe(false)
    expect(opts.maxRetriesPerRequest).toBe(1)
    expect(opts.connectTimeout).toBeLessThanOrEqual(5000)
  })
})

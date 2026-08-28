import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { rateLimit } from '../rate-limiter'

describe('rateLimit', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('allows requests within the limit', () => {
    const result = rateLimit('user1', { maxRequests: 3, windowMs: 60_000 })
    expect(result.success).toBe(true)
    expect(result.remaining).toBe(2)
  })

  it('blocks requests exceeding the limit', () => {
    const opts = { maxRequests: 2, windowMs: 60_000 }
    rateLimit('user2', opts)
    rateLimit('user2', opts)
    const result = rateLimit('user2', opts)
    expect(result.success).toBe(false)
    expect(result.remaining).toBe(0)
  })

  it('resets after the window expires', () => {
    const opts = { maxRequests: 1, windowMs: 1000 }
    rateLimit('user3', opts)
    expect(rateLimit('user3', opts).success).toBe(false)

    vi.advanceTimersByTime(1001)
    expect(rateLimit('user3', opts).success).toBe(true)
  })

  it('tracks different keys independently', () => {
    const opts = { maxRequests: 1, windowMs: 60_000 }
    rateLimit('a', opts)
    expect(rateLimit('b', opts).success).toBe(true)
  })
})

import type { Clock } from '@/domain/ports/clock'
import type { RateLimiterPort } from '@/domain/ports/rate-limiter'

interface Bucket {
  tokens: number
  lastRefillMs: number
}

interface Window {
  count: number
  windowStartMs: number
}

/** In-memory `RateLimiterPort` driven by an injected `Clock`, so token
 * refill and window resets are deterministic under test. Mirrors the real
 * `RedisRateLimiter`'s (WI-2) token-bucket + fixed-window semantics. */
export class FakeRateLimiter implements RateLimiterPort {
  private readonly buckets = new Map<string, Bucket>()
  private readonly windows = new Map<string, Window>()
  private readonly counters = new Map<string, number>()

  constructor(private readonly clock: Clock) {}

  async takeToken(
    key: string,
    opts: { ratePerMin: number; burst: number }
  ): Promise<{ allowed: boolean; remaining: number; retryAfterSec: number }> {
    const nowMs = this.clock.now().getTime()
    const bucket = this.buckets.get(key) ?? { tokens: opts.burst, lastRefillMs: nowMs }
    const elapsedMin = Math.max(0, nowMs - bucket.lastRefillMs) / 60_000
    const refilled = Math.min(opts.burst, bucket.tokens + elapsedMin * opts.ratePerMin)

    if (refilled >= 1) {
      const next: Bucket = { tokens: refilled - 1, lastRefillMs: nowMs }
      this.buckets.set(key, next)
      return { allowed: true, remaining: Math.floor(next.tokens), retryAfterSec: 0 }
    }

    this.buckets.set(key, { tokens: refilled, lastRefillMs: nowMs })
    const deficit = 1 - refilled
    const retryAfterSec = Math.max(1, Math.ceil((deficit / opts.ratePerMin) * 60))
    return { allowed: false, remaining: 0, retryAfterSec }
  }

  async incrWindow(
    key: string,
    limit: number,
    windowSec: number
  ): Promise<{ allowed: boolean; count: number }> {
    const nowMs = this.clock.now().getTime()
    const existing = this.windows.get(key)
    const window: Window =
      existing && nowMs - existing.windowStartMs < windowSec * 1000
        ? existing
        : { count: 0, windowStartMs: nowMs }
    window.count += 1
    this.windows.set(key, window)
    return { allowed: window.count <= limit, count: window.count }
  }

  async incr(key: string): Promise<number> {
    const value = (this.counters.get(key) ?? 0) + 1
    this.counters.set(key, value)
    return value
  }

  async decr(key: string): Promise<number> {
    const value = (this.counters.get(key) ?? 0) - 1
    this.counters.set(key, value)
    return value
  }

  async get(key: string): Promise<number> {
    return this.counters.get(key) ?? 0
  }

  reset(): void {
    this.buckets.clear()
    this.windows.clear()
    this.counters.clear()
  }
}

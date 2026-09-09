import type { Clock } from '@/domain/ports/clock'
import type { RateLimiterPort } from '@/domain/ports/rate-limiter'

interface Bucket {
  tokens: number
  lastRefillMs: number
}

/** In-memory `RateLimiterPort` driven by an injected `Clock`, so token
 * refill and window resets are deterministic under test. Mirrors the real
 * `RedisRateLimiter`'s (WI-2) token-bucket + fixed-window semantics.
 *
 * `incrWindow`/`incr`/`decr`/`get` all read and write the SAME `counters`
 * map, keyed by the caller's key -- exactly like the real adapter, whose
 * `incrWindow` runs a bare Redis `INCR` against that key (see
 * `redis-rate-limiter.ts`'s `INCR_WINDOW_SCRIPT`), the identical key
 * namespace `incr()`/`decr()`/`get()` use. A separate `windowStarts` map
 * tracks only each key's window boundary (not its value), so a fixed
 * window can still reset on expiry without splitting the counter state
 * `get()` reads from the state `incrWindow()` writes to (the bug WI-4's
 * handoff flagged: `get()` after `incrWindow()` on the same key used to
 * always return 0 on the fake, while the real adapter returned the
 * incremented count). */
export class FakeRateLimiter implements RateLimiterPort {
  private readonly buckets = new Map<string, Bucket>()
  private readonly windowStarts = new Map<string, number>()
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
    const windowStart = this.windowStarts.get(key)
    const withinWindow = windowStart !== undefined && nowMs - windowStart < windowSec * 1000
    if (!withinWindow) {
      this.windowStarts.set(key, nowMs)
      this.counters.set(key, 0)
    }
    const count = (this.counters.get(key) ?? 0) + 1
    this.counters.set(key, count)
    return { allowed: count <= limit, count }
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
    this.windowStarts.clear()
    this.counters.clear()
  }
}

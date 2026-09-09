/**
 * Rate limiting primitives used by the inbound auth v2 pipeline (WI-2): a
 * token bucket for the per-integration partner budget, a fixed window for
 * the auth-failure bucket, and plain incr/decr counters for the
 * per-integration queue-depth cap (WI-3).
 */
export interface RateLimiterPort {
  /** Token-bucket check-and-consume. `burst` is the bucket capacity. */
  takeToken(
    key: string,
    opts: { ratePerMin: number; burst: number }
  ): Promise<{ allowed: boolean; remaining: number; retryAfterSec: number }>

  /** Fixed-window counter (e.g. 10 failures / 60s). */
  incrWindow(
    key: string,
    limit: number,
    windowSec: number
  ): Promise<{ allowed: boolean; count: number }>

  incr(key: string): Promise<number>
  decr(key: string): Promise<number>
  get(key: string): Promise<number>
}

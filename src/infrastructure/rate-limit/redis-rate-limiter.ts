// INT-001 WI-2: the real `RateLimiterPort` adapter (WI-1 port + fake +
// contract). Backs the auth-failure bucket, the per-integration partner
// token bucket, the nonce-replay dedup window and the per-integration
// queue-depth counters (WI-3). Every operation is a single atomic Redis
// command (EVAL for the two rate-limit shapes, native INCR/DECR/GET for the
// counters) so the limit holds across concurrent Node processes (T-H5).
//
// Do NOT copy this file's shape for anything else: `src/lib/rate-limit.ts`
// and the pre-existing `src/infrastructure/rate-limit/rate-limiter.ts` are
// in-process Maps -- the T-H5 anti-pattern this class replaces.

import type { Redis } from 'ioredis'
import type { RateLimiterPort } from '@/domain/ports/rate-limiter'

// KEYS[1] = bucket key, ARGV[1] = ratePerMin, ARGV[2] = burst, ARGV[3] = now_ms
// Mirrors FakeRateLimiter's math exactly (continuous refill), so the fake
// and real adapters agree on behaviour at the boundary, not just the shape.
const TAKE_TOKEN_SCRIPT = `
local key = KEYS[1]
local rate_per_min = tonumber(ARGV[1])
local burst = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local data = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])

if tokens == nil then
  tokens = burst
  ts = now
end

local elapsed_min = math.max(0, now - ts) / 60000.0
local refilled = math.min(burst, tokens + elapsed_min * rate_per_min)

local allowed = 0
local remaining = 0
local retry_after = 0

if refilled >= 1 then
  allowed = 1
  refilled = refilled - 1
  remaining = math.floor(refilled)
else
  local deficit = 1 - refilled
  retry_after = math.ceil((deficit / rate_per_min) * 60)
  if retry_after < 1 then retry_after = 1 end
end

redis.call('HMSET', key, 'tokens', tostring(refilled), 'ts', tostring(now))
redis.call('EXPIRE', key, 120)

return {allowed, remaining, retry_after}
`

// KEYS[1] = window key, ARGV[1] = limit, ARGV[2] = windowSec
const INCR_WINDOW_SCRIPT = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window_sec = tonumber(ARGV[2])

local count = redis.call('INCR', key)
if count == 1 then
  redis.call('EXPIRE', key, window_sec)
end

local allowed = 1
if count > limit then
  allowed = 0
end

return {allowed, count}
`

export class RedisRateLimiter implements RateLimiterPort {
  constructor(private readonly redis: Redis) {}

  async takeToken(
    key: string,
    opts: { ratePerMin: number; burst: number }
  ): Promise<{ allowed: boolean; remaining: number; retryAfterSec: number }> {
    const [allowed, remaining, retryAfterSec] = (await this.redis.eval(
      TAKE_TOKEN_SCRIPT,
      1,
      key,
      opts.ratePerMin,
      opts.burst,
      Date.now()
    )) as [number, number, number]
    return { allowed: allowed === 1, remaining, retryAfterSec }
  }

  async incrWindow(
    key: string,
    limit: number,
    windowSec: number
  ): Promise<{ allowed: boolean; count: number }> {
    const [allowed, count] = (await this.redis.eval(
      INCR_WINDOW_SCRIPT,
      1,
      key,
      limit,
      windowSec
    )) as [number, number]
    return { allowed: allowed === 1, count }
  }

  async incr(key: string): Promise<number> {
    return this.redis.incr(key)
  }

  async decr(key: string): Promise<number> {
    return this.redis.decr(key)
  }

  async get(key: string): Promise<number> {
    const value = await this.redis.get(key)
    return value === null ? 0 : Number(value)
  }
}

// INT-001 WI-2: shared Redis connection helpers for NEW code (the rate
// limiter here; WI-3/WI-6's queues per the plan). Existing queues
// (email-queue.ts, campaign-queue.ts, event-dispatch-queue.ts) keep their
// own private copies of this logic -- Surgical Changes: touching them to
// point at a shared module is out of scope for this work item.
//
// Modelled directly on email-queue.ts's parseRedisUrl/producer-connection
// shape (see that file's header comment for the offline-queue rationale).

import type { RedisOptions } from 'ioredis'

export function parseRedisUrl(url: string): RedisOptions {
  const parsed = new URL(url)
  return {
    host: parsed.hostname || 'localhost',
    port: parseInt(parsed.port || '6379', 10),
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
    ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
    ...(parsed.pathname && parsed.pathname !== '/'
      ? { db: parseInt(parsed.pathname.slice(1), 10) }
      : {}),
  }
}

export function redisUrl(): string {
  return process.env.REDIS_URL ?? 'redis://localhost:6379'
}

/**
 * T-H5 "never fail open": a Redis client used synchronously in the request
 * path (the rate limiter) must reject fast on an outage rather than
 * silently queueing commands (the ioredis default) or hanging on retries.
 * `lazyConnect` defers the first connection attempt to the first command,
 * so constructing a client is cheap even if Redis is briefly unavailable at
 * startup.
 */
export function getFailFastRedisOptions(): RedisOptions {
  return {
    ...parseRedisUrl(redisUrl()),
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 5000,
    lazyConnect: true,
  }
}

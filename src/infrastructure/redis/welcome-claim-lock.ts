/**
 * WONB-020 r1 F3: serialises the WhatsApp welcome claim per (restaurant,
 * member), so two near-simultaneous JOINs from an imported member mint one
 * coupon. `SET key token NX PX ttl`; release is an owner-checked Lua DEL, so
 * a run whose lock expired never deletes the next holder's lock.
 *
 * Request path (the webhook): commands queue while the client connects but
 * time out after 2 s, and any Redis error reads as "not acquired" -- the
 * caller then sends welcome-back, never a coupon.
 */
import { randomUUID } from 'node:crypto'
import { Redis } from 'ioredis'
import { parseRedisUrl, redisUrl } from './connection'

export const WELCOME_CLAIM_LOCK_TTL_MS = 30_000

// KEYS[1] = lock key, ARGV[1] = holder token. Deletes only the holder's lock.
const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`

export interface WelcomeClaimLease {
  release(): Promise<void>
}

export type WelcomeClaimLockClient = Pick<Redis, 'set' | 'eval'>

export function welcomeClaimLockKey(restaurantId: string, memberId: string): string {
  return `wonb020:welcome-claim:${restaurantId}:${memberId}`
}

/** Resolves a lease, or null when another run holds the lock. Throws on a Redis error. */
export function createWelcomeClaimLock(client: WelcomeClaimLockClient) {
  return async (restaurantId: string, memberId: string): Promise<WelcomeClaimLease | null> => {
    const key = welcomeClaimLockKey(restaurantId, memberId)
    const token = randomUUID()
    const ok = await client.set(key, token, 'PX', WELCOME_CLAIM_LOCK_TTL_MS, 'NX')
    if (ok !== 'OK') return null
    return {
      release: async () => {
        await client.eval(RELEASE_SCRIPT, 1, key, token)
      },
    }
  }
}

let acquire: ReturnType<typeof createWelcomeClaimLock> | null = null

function getAcquire(): ReturnType<typeof createWelcomeClaimLock> {
  if (!acquire) {
    const client = new Redis({
      ...parseRedisUrl(redisUrl()),
      maxRetriesPerRequest: 1,
      connectTimeout: 5000,
      commandTimeout: 2000,
    })
    client.on('error', (err) => console.error('[WelcomeClaimLock] Redis error:', err.message))
    acquire = createWelcomeClaimLock(client)
  }
  return acquire
}

/**
 * Never throws: a Redis error is logged and reads as not acquired, and the
 * lease's release swallows its own error (the TTL frees the key anyway).
 */
export async function tryAcquireWelcomeClaimLock(
  restaurantId: string,
  memberId: string
): Promise<WelcomeClaimLease | null> {
  let lease: WelcomeClaimLease | null
  try {
    lease = await getAcquire()(restaurantId, memberId)
  } catch (err) {
    console.warn('[onboarding] welcome claim lock unavailable, treating as not acquired:', (err as Error).message)
    return null
  }
  if (!lease) return null
  const held = lease
  return {
    release: () =>
      held.release().catch((err: Error) => {
        console.warn('[onboarding] welcome claim lock release failed:', err.message)
      }),
  }
}

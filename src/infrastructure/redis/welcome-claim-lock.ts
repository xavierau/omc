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

export type WelcomeClaimLockAttempt =
  | { kind: 'acquired'; lease: WelcomeClaimLease }
  | { kind: 'held' }
  | { kind: 'unavailable' }

/**
 * WONB-020 r4 H1: tells "held by another run" from "Redis down", which the
 * new-member path treats differently (held -> a concurrent claim is
 * welcoming this member; down -> onboard without the lock).
 *
 * Never throws: a Redis error is logged and reads as unavailable, and the
 * lease's release swallows its own error (the TTL frees the key anyway).
 */
export async function attemptWelcomeClaimLock(
  restaurantId: string,
  memberId: string
): Promise<WelcomeClaimLockAttempt> {
  let lease: WelcomeClaimLease | null
  try {
    lease = await getAcquire()(restaurantId, memberId)
  } catch (err) {
    console.warn('[onboarding] welcome claim lock unavailable, treating as not acquired:', (err as Error).message)
    return { kind: 'unavailable' }
  }
  if (!lease) return { kind: 'held' }
  const held = lease
  return {
    kind: 'acquired',
    lease: {
      release: () =>
        held.release().catch((err: Error) => {
          console.warn('[onboarding] welcome claim lock release failed:', err.message)
        }),
    },
  }
}

/** The claim path's view: anything but acquired reads as not acquired (null). */
export async function tryAcquireWelcomeClaimLock(
  restaurantId: string,
  memberId: string
): Promise<WelcomeClaimLease | null> {
  const attempt = await attemptWelcomeClaimLock(restaurantId, memberId)
  return attempt.kind === 'acquired' ? attempt.lease : null
}

export const WELCOME_CLAIM_WAIT_INTERVAL_MS = 250
export const WELCOME_CLAIM_WAIT_TIMEOUT_MS = 5_000

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * WONB-020 r6 J2: a new member's first attempt found the lock held, so a
 * concurrent JOIN claim is welcoming them. Retry every `intervalMs` for at
 * most `timeoutMs` (default 250 ms x 20 = 5 s). Resolves the lease, or null
 * when still held at the deadline or Redis errors mid-wait: fail closed,
 * since a claim was in flight a moment ago. Never throws.
 */
export async function waitForWelcomeClaimLock(
  restaurantId: string,
  memberId: string,
  { intervalMs = WELCOME_CLAIM_WAIT_INTERVAL_MS, timeoutMs = WELCOME_CLAIM_WAIT_TIMEOUT_MS } = {}
): Promise<WelcomeClaimLease | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() + intervalMs <= deadline) {
    await sleep(intervalMs)
    const attempt = await attemptWelcomeClaimLock(restaurantId, memberId)
    if (attempt.kind === 'acquired') return attempt.lease
    if (attempt.kind === 'unavailable') return null
  }
  return null
}

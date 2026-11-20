// WONB-020 r1 F3: the welcome-claim lock against a real Redis (NX, TTL,
// owner-checked release). Runs only with RUN_REDIS_TESTS=1 and REDIS_TEST_URL
// (a throwaway Redis; the test deletes nothing but its own key).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Redis } from 'ioredis'
import { createWelcomeClaimLock, welcomeClaimLockKey, WELCOME_CLAIM_LOCK_TTL_MS } from '../welcome-claim-lock'
import { parseRedisUrl } from '../connection'

const RUN = process.env.RUN_REDIS_TESTS === '1' && !!process.env.REDIS_TEST_URL
const d = RUN ? describe : describe.skip

const RESTAURANT = `rest-${Date.now()}`
const MEMBER = 'm-lock'

d('WONB-020 welcome claim lock (real Redis)', () => {
  let client: Redis
  beforeAll(() => {
    client = new Redis(parseRedisUrl(process.env.REDIS_TEST_URL as string))
  })
  afterAll(async () => {
    await client.del(welcomeClaimLockKey(RESTAURANT, MEMBER))
    client.disconnect()
  })

  it('one holder at a time; a released lock can be taken again; TTL is set', async () => {
    const acquire = createWelcomeClaimLock(client)
    const [a, b] = await Promise.all([acquire(RESTAURANT, MEMBER), acquire(RESTAURANT, MEMBER)])
    expect([a, b].filter(Boolean)).toHaveLength(1)

    const pttl = await client.pttl(welcomeClaimLockKey(RESTAURANT, MEMBER))
    expect(pttl).toBeGreaterThan(0)
    expect(pttl).toBeLessThanOrEqual(WELCOME_CLAIM_LOCK_TTL_MS)

    await (a ?? b)!.release()
    const c = await acquire(RESTAURANT, MEMBER)
    expect(c).not.toBeNull()
    await c!.release()
  })

  it('a stale lease (its lock expired and was re-taken) cannot release the new holder', async () => {
    const acquire = createWelcomeClaimLock(client)
    const stale = await acquire(RESTAURANT, MEMBER)
    expect(stale).not.toBeNull()
    await client.del(welcomeClaimLockKey(RESTAURANT, MEMBER)) // simulate expiry
    const current = await acquire(RESTAURANT, MEMBER)
    expect(current).not.toBeNull()

    await stale!.release()
    expect(await client.exists(welcomeClaimLockKey(RESTAURANT, MEMBER))).toBe(1)
    expect(await acquire(RESTAURANT, MEMBER)).toBeNull()

    await current!.release()
    expect(await client.exists(welcomeClaimLockKey(RESTAURANT, MEMBER))).toBe(0)
  })
})

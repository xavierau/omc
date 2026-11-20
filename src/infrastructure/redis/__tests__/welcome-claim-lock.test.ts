// WONB-020 r1 F3: the welcome-claim lock's contract with Redis (unit, fake
// client) and the never-throw wrapper the webhook path relies on.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fakeClient = { set: vi.fn(), eval: vi.fn(), on: vi.fn() }
vi.mock('ioredis', () => ({ Redis: vi.fn(function () { return fakeClient }) }))

import {
  createWelcomeClaimLock,
  tryAcquireWelcomeClaimLock,
  welcomeClaimLockKey,
  WELCOME_CLAIM_LOCK_TTL_MS,
} from '../welcome-claim-lock'

describe('welcome claim lock (WONB-020 r1 F3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fakeClient.set.mockReset()
    fakeClient.eval.mockReset()
  })

  it('acquires with SET NX PX on the (restaurant, member) key and a per-holder token', async () => {
    fakeClient.set.mockResolvedValue('OK')

    const lease = await createWelcomeClaimLock(fakeClient as never)('rest-1', 'm-1')

    expect(lease).not.toBeNull()
    const [key, token, px, ttl, nx] = fakeClient.set.mock.calls[0]
    expect(key).toBe(welcomeClaimLockKey('rest-1', 'm-1'))
    expect(key).toBe('wonb020:welcome-claim:rest-1:m-1')
    expect(typeof token).toBe('string')
    expect(token.length).toBeGreaterThan(10)
    expect([px, ttl, nx]).toEqual(['PX', WELCOME_CLAIM_LOCK_TTL_MS, 'NX'])
    expect(WELCOME_CLAIM_LOCK_TTL_MS).toBeGreaterThanOrEqual(10_000)
    expect(WELCOME_CLAIM_LOCK_TTL_MS).toBeLessThanOrEqual(60_000)
  })

  it('held by another run (SET NX returns null) -> null, no release', async () => {
    fakeClient.set.mockResolvedValue(null)

    expect(await createWelcomeClaimLock(fakeClient as never)('rest-1', 'm-1')).toBeNull()
    expect(fakeClient.eval).not.toHaveBeenCalled()
  })

  it('release is an owner-checked delete with the holder token, so only the holder releases', async () => {
    fakeClient.set.mockResolvedValue('OK')
    fakeClient.eval.mockResolvedValue(1)
    const acquire = createWelcomeClaimLock(fakeClient as never)

    const a = await acquire('rest-1', 'm-1')
    const b = await acquire('rest-1', 'm-1')
    await a!.release()
    await b!.release()

    const tokenA = fakeClient.set.mock.calls[0][1]
    const tokenB = fakeClient.set.mock.calls[1][1]
    expect(tokenA).not.toBe(tokenB)
    const [scriptA, numKeysA, keyA, argA] = fakeClient.eval.mock.calls[0]
    expect(scriptA).toMatch(/GET[\s\S]*==\s*ARGV\[1\][\s\S]*DEL/)
    expect([numKeysA, keyA, argA]).toEqual([1, 'wonb020:welcome-claim:rest-1:m-1', tokenA])
    expect(fakeClient.eval.mock.calls[1][3]).toBe(tokenB)
  })

  describe('tryAcquireWelcomeClaimLock (never throws)', () => {
    it('Redis error on acquire -> null with a warning', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      fakeClient.set.mockRejectedValue(new Error('Command timed out'))

      expect(await tryAcquireWelcomeClaimLock('rest-1', 'm-1')).toBeNull()
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('lock unavailable'), 'Command timed out')
      warn.mockRestore()
    })

    it('not acquired -> null', async () => {
      fakeClient.set.mockResolvedValue(null)
      expect(await tryAcquireWelcomeClaimLock('rest-1', 'm-1')).toBeNull()
    })

    it('a release error is swallowed with a warning', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      fakeClient.set.mockResolvedValue('OK')
      fakeClient.eval.mockRejectedValue(new Error('Connection is closed.'))

      const lease = await tryAcquireWelcomeClaimLock('rest-1', 'm-1')
      await expect(lease!.release()).resolves.toBeUndefined()
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('release failed'), 'Connection is closed.')
      warn.mockRestore()
    })
  })
})

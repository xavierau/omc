// WONB-020 r1 F3: the welcome-claim lock's contract with Redis (unit, fake
// client) and the never-throw wrapper the webhook path relies on.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fakeClient = { set: vi.fn(), eval: vi.fn(), on: vi.fn() }
vi.mock('ioredis', () => ({ Redis: vi.fn(function () { return fakeClient }) }))

import {
  attemptWelcomeClaimLock,
  createWelcomeClaimLock,
  tryAcquireWelcomeClaimLock,
  waitForWelcomeClaimLock,
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
  // r4 H1: new-member onboarding must tell "held by a concurrent claim" from
  // "Redis down": held -> skip the mint, Redis down -> onboard without it.
  describe('attemptWelcomeClaimLock (r4 H1, never throws)', () => {
    it('acquired -> kind acquired with a releasable lease', async () => {
      fakeClient.set.mockResolvedValue('OK')
      fakeClient.eval.mockResolvedValue(1)

      const attempt = await attemptWelcomeClaimLock('rest-1', 'm-1')

      expect(attempt.kind).toBe('acquired')
      if (attempt.kind !== 'acquired') return
      await attempt.lease.release()
      expect(fakeClient.eval.mock.calls[0][2]).toBe('wonb020:welcome-claim:rest-1:m-1')
    })

    it('held by another run -> kind held, no release', async () => {
      fakeClient.set.mockResolvedValue(null)

      expect(await attemptWelcomeClaimLock('rest-1', 'm-1')).toEqual({ kind: 'held' })
      expect(fakeClient.eval).not.toHaveBeenCalled()
    })

    it('Redis error -> kind unavailable with a warning', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      fakeClient.set.mockRejectedValue(new Error('Command timed out'))

      expect(await attemptWelcomeClaimLock('rest-1', 'm-1')).toEqual({ kind: 'unavailable' })
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('lock unavailable'), 'Command timed out')
      warn.mockRestore()
    })
  })
  // r6 J2: a new member whose lock is held waits for the concurrent claim
  // (bounded), instead of returning un-welcomed.
  describe('waitForWelcomeClaimLock (r6 J2, never throws)', () => {
    it('held, then released -> retries at the interval and resolves the lease', async () => {
      fakeClient.set.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce('OK')
      fakeClient.eval.mockResolvedValue(1)

      const lease = await waitForWelcomeClaimLock('rest-1', 'm-1', { intervalMs: 1, timeoutMs: 1000 })

      expect(lease).not.toBeNull()
      expect(fakeClient.set).toHaveBeenCalledTimes(3)
      await lease?.release()
      expect(fakeClient.eval.mock.calls[0][2]).toBe('wonb020:welcome-claim:rest-1:m-1')
    })

    it('still held at the deadline -> null; the default wait is 250 ms x 20 = 5 s, no busy loop', async () => {
      vi.useFakeTimers()
      try {
        fakeClient.set.mockResolvedValue(null)
        let settled: unknown = 'pending'
        void waitForWelcomeClaimLock('rest-1', 'm-1').then((v) => (settled = v))

        await vi.advanceTimersByTimeAsync(4_999)
        expect(settled).toBe('pending')
        expect(fakeClient.set).toHaveBeenCalledTimes(19)
        await vi.advanceTimersByTimeAsync(1)

        expect(settled).toBeNull()
        expect(fakeClient.set).toHaveBeenCalledTimes(20)
      } finally {
        vi.useRealTimers()
      }
    })

    it('Redis error mid-wait -> null at once (fail closed: a claim was in flight), with a warning', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      fakeClient.set.mockRejectedValue(new Error('Command timed out'))

      expect(await waitForWelcomeClaimLock('rest-1', 'm-1', { intervalMs: 1, timeoutMs: 1000 })).toBeNull()
      expect(fakeClient.set).toHaveBeenCalledTimes(1)
      warn.mockRestore()
    })
  })
})

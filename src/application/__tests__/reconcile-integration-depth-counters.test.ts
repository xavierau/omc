import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/integration-member-job-repository', () => ({
  countNonTerminalJobsByIntegration: vi.fn(),
  countNonTerminalJobsForIntegration: vi.fn(),
}))

import {
  countNonTerminalJobsByIntegration,
  countNonTerminalJobsForIntegration,
} from '@/infrastructure/supabase/repositories/integration-member-job-repository'
import type { RateLimiterPort } from '@/domain/ports/rate-limiter'
import {
  reconcileAllIntegrationDepthCounters,
  reconcileIntegrationDepthCounter,
} from '../reconcile-integration-depth-counters'

function fakeRateLimiter(initial: Record<string, number> = {}): RateLimiterPort & { store: Map<string, number> } {
  const store = new Map<string, number>(Object.entries(initial))
  return {
    store,
    takeToken: vi.fn(),
    incrWindow: vi.fn(),
    incr: vi.fn(),
    decr: vi.fn(),
    get: vi.fn(async (key: string) => store.get(key) ?? 0),
    set: vi.fn(async (key: string, value: number) => {
      store.set(key, value)
    }),
  } as unknown as RateLimiterPort & { store: Map<string, number> }
}

describe('reconcileAllIntegrationDepthCounters (INT-001 WI-13 Gap B)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('corrects a counter that drifted HIGH (crashed job left it inflated)', async () => {
    vi.mocked(countNonTerminalJobsByIntegration).mockResolvedValue([{ integrationId: 'int-1', count: 2 }])
    const limiter = fakeRateLimiter({ 'int001:depth:int-1': 9 })

    const corrections = await reconcileAllIntegrationDepthCounters(limiter)

    expect(limiter.get('int001:depth:int-1')).resolves.toBe(2)
    expect(limiter.set).toHaveBeenCalledWith('int001:depth:int-1', 2)
    expect(corrections).toEqual([{ integrationId: 'int-1', previousCount: 9, truthCount: 2 }])
  })

  it('corrects a counter that drifted LOW (a Redis flush lost the reservations)', async () => {
    vi.mocked(countNonTerminalJobsByIntegration).mockResolvedValue([{ integrationId: 'int-1', count: 5 }])
    const limiter = fakeRateLimiter({ 'int001:depth:int-1': 0 })

    const corrections = await reconcileAllIntegrationDepthCounters(limiter)

    expect(limiter.set).toHaveBeenCalledWith('int001:depth:int-1', 5)
    expect(corrections).toEqual([{ integrationId: 'int-1', previousCount: 0, truthCount: 5 }])
  })

  it('no drift -> no write (idempotent)', async () => {
    vi.mocked(countNonTerminalJobsByIntegration).mockResolvedValue([{ integrationId: 'int-1', count: 3 }])
    const limiter = fakeRateLimiter({ 'int001:depth:int-1': 3 })

    const corrections = await reconcileAllIntegrationDepthCounters(limiter)

    expect(limiter.set).not.toHaveBeenCalled()
    expect(corrections).toEqual([])
  })

  it('reconciles multiple integrations independently in one run', async () => {
    vi.mocked(countNonTerminalJobsByIntegration).mockResolvedValue([
      { integrationId: 'int-1', count: 1 },
      { integrationId: 'int-2', count: 0 },
      { integrationId: 'int-3', count: 4 },
    ])
    const limiter = fakeRateLimiter({
      'int001:depth:int-1': 1,
      'int001:depth:int-2': 7,
      // int-3 never had a Redis key at all -- get() returns 0 by construction.
    })

    const corrections = await reconcileAllIntegrationDepthCounters(limiter)

    expect(corrections).toEqual([
      { integrationId: 'int-2', previousCount: 7, truthCount: 0 },
      { integrationId: 'int-3', previousCount: 0, truthCount: 4 },
    ])
  })

  it('never throws: a Postgres failure fetching the truth set is swallowed and logged, returns []', async () => {
    vi.mocked(countNonTerminalJobsByIntegration).mockRejectedValue(new Error('connection refused'))
    const limiter = fakeRateLimiter()

    await expect(reconcileAllIntegrationDepthCounters(limiter)).resolves.toEqual([])
    expect(limiter.set).not.toHaveBeenCalled()
  })

  it('one integration failing (Redis error) does not block reconciling the others', async () => {
    vi.mocked(countNonTerminalJobsByIntegration).mockResolvedValue([
      { integrationId: 'int-bad', count: 1 },
      { integrationId: 'int-good', count: 2 },
    ])
    const limiter = fakeRateLimiter({ 'int001:depth:int-good': 9 })
    vi.mocked(limiter.get).mockImplementation(async (key: string) => {
      if (key === 'int001:depth:int-bad') throw new Error('redis timeout')
      return limiter.store.get(key) ?? 0
    })

    const corrections = await reconcileAllIntegrationDepthCounters(limiter)

    expect(corrections).toEqual([{ integrationId: 'int-good', previousCount: 9, truthCount: 2 }])
  })
})

describe('reconcileIntegrationDepthCounter (single-integration manual recovery)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reads Postgres truth for ONE integration and corrects the Redis counter', async () => {
    vi.mocked(countNonTerminalJobsForIntegration).mockResolvedValue(0)
    const limiter = fakeRateLimiter({ 'int001:depth:int-1': 12 })

    const correction = await reconcileIntegrationDepthCounter('int-1', limiter)

    expect(countNonTerminalJobsForIntegration).toHaveBeenCalledWith('int-1')
    expect(limiter.set).toHaveBeenCalledWith('int001:depth:int-1', 0)
    expect(correction).toEqual({ integrationId: 'int-1', previousCount: 12, truthCount: 0 })
  })

  it('returns null when the counter already matches (no write)', async () => {
    vi.mocked(countNonTerminalJobsForIntegration).mockResolvedValue(3)
    const limiter = fakeRateLimiter({ 'int001:depth:int-1': 3 })

    const correction = await reconcileIntegrationDepthCounter('int-1', limiter)

    expect(limiter.set).not.toHaveBeenCalled()
    expect(correction).toBeNull()
  })
})

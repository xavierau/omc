import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TenantOnboardingState } from '@/domain/entities/onboarding/tenant-onboarding-state'
import type { TenantOnboardingStateRepository } from '@/domain/repositories/tenant-onboarding-state-repository'
import { initializeOnboardingState } from '../initialize-onboarding-state'

const RESTAURANT_ID = 'rest-1'
const NOW = '2026-05-05T00:00:00.000Z'

function makeRepo(): TenantOnboardingStateRepository {
  return {
    findByRestaurantId: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    advance: vi.fn(),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(NOW))
})

describe('initializeOnboardingState', () => {
  it('returns the existing row if one exists (idempotent)', async () => {
    const repo = makeRepo()
    const existing = TenantOnboardingState.createDefault({
      id: 'id-1',
      restaurantId: RESTAURANT_ID,
      now: '2026-04-01T00:00:00.000Z',
    })
    vi.mocked(repo.findByRestaurantId).mockResolvedValueOnce(existing)

    const out = await initializeOnboardingState({ restaurantId: RESTAURANT_ID, repo })

    expect(out).toBe(existing)
    expect(repo.insert).not.toHaveBeenCalled()
  })

  it('inserts a default row when none exists', async () => {
    const repo = makeRepo()
    vi.mocked(repo.findByRestaurantId).mockResolvedValueOnce(null)
    vi.mocked(repo.insert).mockResolvedValueOnce(undefined)

    const out = await initializeOnboardingState({ restaurantId: RESTAURANT_ID, repo })

    expect(repo.insert).toHaveBeenCalledTimes(1)
    expect(out.snapshot.restaurantId).toBe(RESTAURANT_ID)
    expect(out.snapshot.phase).toBe('setup')
    expect(out.snapshot.onboardingPath).toBeNull()
    expect(out.snapshot.createdAt).toBe(NOW)
  })

  it('falls back to findByRestaurantId on insert race', async () => {
    const repo = makeRepo()
    vi.mocked(repo.findByRestaurantId)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        TenantOnboardingState.createDefault({
          id: 'id-2',
          restaurantId: RESTAURANT_ID,
          now: NOW,
        })
      )
    vi.mocked(repo.insert).mockRejectedValueOnce(new Error('duplicate key'))

    const out = await initializeOnboardingState({ restaurantId: RESTAURANT_ID, repo })

    expect(out.snapshot.id).toBe('id-2')
    expect(repo.findByRestaurantId).toHaveBeenCalledTimes(2)
  })

  it('rethrows if insert fails AND fallback also returns null', async () => {
    const repo = makeRepo()
    vi.mocked(repo.findByRestaurantId)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    const err = new Error('db down')
    vi.mocked(repo.insert).mockRejectedValueOnce(err)

    await expect(
      initializeOnboardingState({ restaurantId: RESTAURANT_ID, repo })
    ).rejects.toThrow('db down')
  })
})

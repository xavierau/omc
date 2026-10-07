import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TenantOnboardingState } from '@/domain/entities/onboarding/tenant-onboarding-state'
import {
  ConcurrentAdvanceError,
  OnboardingPathLockedError,
} from '@/domain/services/__errors__/onboarding-errors'
import type { TenantOnboardingStateRepository } from '@/domain/repositories/tenant-onboarding-state-repository'
import { setOnboardingPath } from '../set-onboarding-path'

const RESTAURANT_ID = 'rest-1'

function makeRepo(): TenantOnboardingStateRepository {
  return {
    findByRestaurantId: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    advance: vi.fn(),
  }
}

function defaultState() {
  return TenantOnboardingState.createDefault({
    id: 'id-1',
    restaurantId: RESTAURANT_ID,
    now: '2026-05-05T00:00:00.000Z',
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-05-05T01:00:00.000Z'))
})

describe('setOnboardingPath', () => {
  it('updates the path and persists via repo.update', async () => {
    const repo = makeRepo()
    vi.mocked(repo.findByRestaurantId).mockResolvedValueOnce(defaultState())
    vi.mocked(repo.update).mockResolvedValueOnce(undefined)

    const out = await setOnboardingPath({
      restaurantId: RESTAURANT_ID,
      path: 'A',
      repo,
    })

    expect(repo.update).toHaveBeenCalledTimes(1)
    expect(out.snapshot.onboardingPath).toBe('A')
  })

  it('auto-marks hk_sim_never_used as not_applicable for path B1', async () => {
    const repo = makeRepo()
    vi.mocked(repo.findByRestaurantId).mockResolvedValueOnce(defaultState())
    vi.mocked(repo.update).mockResolvedValueOnce(undefined)

    const out = await setOnboardingPath({
      restaurantId: RESTAURANT_ID,
      path: 'B1',
      repo,
    })

    expect(out.snapshot.checklist.hk_sim_never_used.status).toBe('not_applicable')
    expect(out.snapshot.checklist.hk_sim_never_used.checked).toBe(true)
  })

  it('throws OnboardingPathLockedError when phase != setup', async () => {
    const repo = makeRepo()
    const advanced = TenantOnboardingState.fromProps({
      ...defaultState().snapshot,
      onboardingPath: 'A',
      phase: 'probe',
    })
    vi.mocked(repo.findByRestaurantId).mockResolvedValueOnce(advanced)

    await expect(
      setOnboardingPath({ restaurantId: RESTAURANT_ID, path: 'B2', repo })
    ).rejects.toThrow(OnboardingPathLockedError)
    expect(repo.update).not.toHaveBeenCalled()
  })

  it('throws when no state exists for the tenant', async () => {
    const repo = makeRepo()
    vi.mocked(repo.findByRestaurantId).mockResolvedValueOnce(null)

    await expect(
      setOnboardingPath({ restaurantId: RESTAURANT_ID, path: 'A', repo })
    ).rejects.toThrow(/not found/i)
  })

  it('passes expectedPhase=setup to repo.update for optimistic concurrency', async () => {
    const repo = makeRepo()
    vi.mocked(repo.findByRestaurantId).mockResolvedValueOnce(defaultState())
    vi.mocked(repo.update).mockResolvedValueOnce(undefined)

    await setOnboardingPath({ restaurantId: RESTAURANT_ID, path: 'A', repo })

    expect(repo.update).toHaveBeenCalledTimes(1)
    const [, expectedPhase] = vi.mocked(repo.update).mock.calls[0]
    expect(expectedPhase).toBe('setup')
  })

  it('translates ConcurrentAdvanceError from repo.update into OnboardingPathLockedError', async () => {
    const repo = makeRepo()
    vi.mocked(repo.findByRestaurantId).mockResolvedValueOnce(defaultState())
    vi.mocked(repo.update).mockRejectedValueOnce(new ConcurrentAdvanceError())

    await expect(
      setOnboardingPath({ restaurantId: RESTAURANT_ID, path: 'A', repo })
    ).rejects.toBeInstanceOf(OnboardingPathLockedError)
  })
})

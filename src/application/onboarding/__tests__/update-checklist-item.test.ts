import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TenantOnboardingState } from '@/domain/entities/onboarding/tenant-onboarding-state'
import { ConcurrentAdvanceError } from '@/domain/services/__errors__/onboarding-errors'
import type { TenantOnboardingStateRepository } from '@/domain/repositories/tenant-onboarding-state-repository'
import { updateChecklistItem } from '../update-checklist-item'

const RESTAURANT_ID = 'rest-1'
const ACTOR = 'admin-1'
const NOW = '2026-05-05T01:23:45.000Z'

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
  vi.setSystemTime(new Date(NOW))
})

describe('updateChecklistItem', () => {
  it('ticks an item and persists via repo.update', async () => {
    const repo = makeRepo()
    vi.mocked(repo.findByRestaurantId).mockResolvedValueOnce(defaultState())
    vi.mocked(repo.update).mockResolvedValueOnce(undefined)

    const out = await updateChecklistItem({
      restaurantId: RESTAURANT_ID,
      key: 'verified_meta_business',
      checked: true,
      actor: ACTOR,
      repo,
    })

    expect(out.snapshot.checklist.verified_meta_business.checked).toBe(true)
    expect(out.snapshot.checklist.verified_meta_business.checkedAt).toBe(NOW)
    expect(out.snapshot.checklist.verified_meta_business.checkedBy).toBe(ACTOR)
    expect(repo.update).toHaveBeenCalledTimes(1)
  })

  it('unticks an item (sets checkedAt/By to null)', async () => {
    const repo = makeRepo()
    const state = defaultState().tickChecklist('vertical_allowed', ACTOR, NOW)
    vi.mocked(repo.findByRestaurantId).mockResolvedValueOnce(state)
    vi.mocked(repo.update).mockResolvedValueOnce(undefined)

    const out = await updateChecklistItem({
      restaurantId: RESTAURANT_ID,
      key: 'vertical_allowed',
      checked: false,
      actor: ACTOR,
      repo,
    })

    expect(out.snapshot.checklist.vertical_allowed.checked).toBe(false)
    expect(out.snapshot.checklist.vertical_allowed.checkedAt).toBeNull()
    expect(out.snapshot.checklist.vertical_allowed.checkedBy).toBeNull()
  })

  it('is a no-op when ticking a not_applicable item (path B1)', async () => {
    const repo = makeRepo()
    const state = defaultState().setPath('B1', NOW)
    vi.mocked(repo.findByRestaurantId).mockResolvedValueOnce(state)
    vi.mocked(repo.update).mockResolvedValueOnce(undefined)

    const out = await updateChecklistItem({
      restaurantId: RESTAURANT_ID,
      key: 'hk_sim_never_used',
      checked: true,
      actor: ACTOR,
      repo,
    })

    // Item stays N/A — no change.
    expect(out.snapshot.checklist.hk_sim_never_used.status).toBe('not_applicable')
  })

  it('throws when state not found', async () => {
    const repo = makeRepo()
    vi.mocked(repo.findByRestaurantId).mockResolvedValueOnce(null)

    await expect(
      updateChecklistItem({
        restaurantId: RESTAURANT_ID,
        key: 'verified_meta_business',
        checked: true,
        actor: ACTOR,
        repo,
      })
    ).rejects.toThrow(/not found/i)
  })

  it('passes expectedPhase=current snapshot phase to repo.update', async () => {
    const repo = makeRepo()
    vi.mocked(repo.findByRestaurantId).mockResolvedValueOnce(defaultState())
    vi.mocked(repo.update).mockResolvedValueOnce(undefined)

    await updateChecklistItem({
      restaurantId: RESTAURANT_ID,
      key: 'verified_meta_business',
      checked: true,
      actor: ACTOR,
      repo,
    })

    expect(repo.update).toHaveBeenCalledTimes(1)
    const [, expectedPhase] = vi.mocked(repo.update).mock.calls[0]
    expect(expectedPhase).toBe('setup')
  })

  it('rethrows ConcurrentAdvanceError from repo.update as-is', async () => {
    const repo = makeRepo()
    vi.mocked(repo.findByRestaurantId).mockResolvedValueOnce(defaultState())
    vi.mocked(repo.update).mockRejectedValueOnce(new ConcurrentAdvanceError())

    await expect(
      updateChecklistItem({
        restaurantId: RESTAURANT_ID,
        key: 'verified_meta_business',
        checked: true,
        actor: ACTOR,
        repo,
      })
    ).rejects.toBeInstanceOf(ConcurrentAdvanceError)
  })
})

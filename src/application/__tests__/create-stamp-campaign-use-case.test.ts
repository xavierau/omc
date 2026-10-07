import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/stamp-campaign-repository')
vi.mock('@/infrastructure/supabase/repositories/stamp-campaign-write-repository')
vi.mock('@/infrastructure/supabase/repositories/platform-settings-repository')

import {
  countRewards,
  rewardExistsForRestaurant,
} from '@/infrastructure/supabase/repositories/stamp-campaign-repository'
import { createStampCampaign } from '@/infrastructure/supabase/repositories/stamp-campaign-write-repository'
import { getStampCapPolicy } from '@/infrastructure/supabase/repositories/platform-settings-repository'
import {
  createStampCampaignUseCase,
  NoRewardsError,
  RewardNotFoundError,
  CapBlockedError,
} from '../create-stamp-campaign-use-case'

const BASE = {
  restaurantId: 'r-1',
  name: 'Coffee Card',
  stampsRequired: 10,
  rewardId: 'rw-1',
}

function createdRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c-1',
    restaurantId: 'r-1',
    name: 'Coffee Card',
    nameZh: null,
    stampsRequired: 10,
    rewardId: 'rw-1',
    status: 'draft' as const,
    maxStampsPerDay: 1,
    honorUntil: null,
    ...overrides,
  }
}

describe('createStampCampaignUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(countRewards).mockResolvedValue(2)
    vi.mocked(rewardExistsForRestaurant).mockResolvedValue(true)
    vi.mocked(getStampCapPolicy).mockResolvedValue({ enforcement: 'warn', warnThreshold: 1 })
    vi.mocked(createStampCampaign).mockResolvedValue(createdRow())
  })

  it('creates a draft campaign when the reward exists and rewards are present', async () => {
    const result = await createStampCampaignUseCase(BASE)

    expect(createStampCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ restaurantId: 'r-1', rewardId: 'rw-1', stampsRequired: 10 })
    )
    expect(result.campaign.status).toBe('draft')
    expect(result.warning).toBeUndefined()
  })

  it('blocks creation when the restaurant has zero rewards (Story 1 AC)', async () => {
    vi.mocked(countRewards).mockResolvedValue(0)

    await expect(createStampCampaignUseCase(BASE)).rejects.toBeInstanceOf(NoRewardsError)
    expect(createStampCampaign).not.toHaveBeenCalled()
  })

  it('rejects a reward_id that does not belong to the restaurant', async () => {
    vi.mocked(rewardExistsForRestaurant).mockResolvedValue(false)

    await expect(createStampCampaignUseCase(BASE)).rejects.toBeInstanceOf(RewardNotFoundError)
    expect(createStampCampaign).not.toHaveBeenCalled()
  })

  it('block policy: rejects max_stamps_per_day above the threshold', async () => {
    vi.mocked(getStampCapPolicy).mockResolvedValue({ enforcement: 'block', warnThreshold: 1 })

    await expect(
      createStampCampaignUseCase({ ...BASE, maxStampsPerDay: 3 })
    ).rejects.toBeInstanceOf(CapBlockedError)
    expect(createStampCampaign).not.toHaveBeenCalled()
  })

  it('warn policy: creates but returns a warning when above the threshold', async () => {
    vi.mocked(getStampCapPolicy).mockResolvedValue({ enforcement: 'warn', warnThreshold: 1 })
    vi.mocked(createStampCampaign).mockResolvedValue(createdRow({ maxStampsPerDay: 3 }))

    const result = await createStampCampaignUseCase({ ...BASE, maxStampsPerDay: 3 })

    expect(result.campaign.maxStampsPerDay).toBe(3)
    expect(result.warning).toContain('forwarded-screenshot')
    expect(createStampCampaign).toHaveBeenCalled()
  })

  it('off policy: creates silently above the threshold (no warning)', async () => {
    vi.mocked(getStampCapPolicy).mockResolvedValue({ enforcement: 'off', warnThreshold: 1 })
    vi.mocked(createStampCampaign).mockResolvedValue(createdRow({ maxStampsPerDay: 5 }))

    const result = await createStampCampaignUseCase({ ...BASE, maxStampsPerDay: 5 })

    expect(result.warning).toBeUndefined()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/stamp-card-repository', () => ({
  getStampCardById: vi.fn(),
  openNextStampCard: vi.fn(),
}))

vi.mock('@/infrastructure/supabase/repositories/reward-repository', () => ({
  getRewardById: vi.fn(),
}))

vi.mock('@/application/mint-and-deliver-reward', () => ({
  mintAndDeliverReward: vi.fn(),
}))

vi.mock('@/application/emit-event', () => ({
  emitEvent: vi.fn(),
}))

vi.mock('@/infrastructure/supabase/repositories/member-repository', () => ({
  adjustMemberPoints: vi.fn(),
}))

import { completeStampCardUseCase } from '@/application/complete-stamp-card'
import { getStampCardById, openNextStampCard } from '@/infrastructure/supabase/repositories/stamp-card-repository'
import { getRewardById } from '@/infrastructure/supabase/repositories/reward-repository'
import { mintAndDeliverReward } from '@/application/mint-and-deliver-reward'
import { emitEvent } from '@/application/emit-event'
import { adjustMemberPoints } from '@/infrastructure/supabase/repositories/member-repository'

const params = {
  restaurantId: 'r-1',
  memberId: 'm-1',
  campaignId: 'c-1',
  cardId: 'card-1',
  phone: '85291234567',
  phoneNumberId: 'phone-id-1',
  language: 'en' as const,
}

function buildCard(overrides = {}) {
  return {
    id: 'card-1',
    restaurantId: 'r-1',
    memberId: 'm-1',
    campaignId: 'c-1',
    stampsCount: 10,
    stampsRequired: 10,
    rewardId: 'rw-1',
    status: 'completed' as const,
    ...overrides,
  }
}

function buildReward(overrides = {}) {
  return {
    id: 'rw-1',
    restaurantId: 'r-1',
    name: 'Free Coffee',
    pointsCost: 50,
    discountType: 'percentage' as const,
    discountValue: 100,
    couponExpiryDays: 30,
    isActive: true,
    sortOrder: 0,
    ...overrides,
  }
}

describe('completeStampCardUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getStampCardById).mockResolvedValue(buildCard())
    vi.mocked(getRewardById).mockResolvedValue(buildReward())
    vi.mocked(mintAndDeliverReward).mockResolvedValue('STAMP-RWD1')
  })

  it('mints a no-points reward from the SNAPSHOTTED reward id and does NOT touch points', async () => {
    await completeStampCardUseCase(params)

    expect(getRewardById).toHaveBeenCalledWith('rw-1')
    expect(mintAndDeliverReward).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: 'r-1',
        memberId: 'm-1',
        phone: '85291234567',
        phoneNumberId: 'phone-id-1',
        source: 'stamp_campaign',
      })
    )
    expect(adjustMemberPoints).not.toHaveBeenCalled()
  })

  it('emits a reward_redeem metrics event tagged source=stamp_campaign', async () => {
    await completeStampCardUseCase(params)

    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: 'r-1',
        memberId: 'm-1',
        type: 'reward_redeem',
        source: 'stamp_campaign',
        dataJson: expect.objectContaining({
          reward_id: 'rw-1',
          coupon_code: 'STAMP-RWD1',
          source: 'stamp_campaign',
        }),
      })
    )
  })

  it('opens a fresh in_progress card after minting', async () => {
    await completeStampCardUseCase(params)

    expect(openNextStampCard).toHaveBeenCalledWith({
      restaurantId: 'r-1',
      memberId: 'm-1',
      campaignId: 'c-1',
    })
  })

  it('throws when the snapshotted reward no longer exists', async () => {
    vi.mocked(getRewardById).mockResolvedValue(null)

    await expect(completeStampCardUseCase(params)).rejects.toThrow()
    expect(mintAndDeliverReward).not.toHaveBeenCalled()
  })
})

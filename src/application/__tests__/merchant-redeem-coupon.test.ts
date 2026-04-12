import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Coupon } from '@/domain/entities/coupon'

vi.mock('@/infrastructure/supabase/repositories/coupon-repository', () => ({
  findCouponByCode: vi.fn(),
  redeemCoupon: vi.fn(),
  incrementCouponUses: vi.fn(),
}))

vi.mock('@/infrastructure/supabase/repositories/coupon-redemption-repository', () => ({
  createRedemption: vi.fn(),
}))

vi.mock('@/infrastructure/supabase/repositories/event-repository', () => ({
  createEvent: vi.fn(),
}))

vi.mock('@/infrastructure/supabase/repositories/campaign-repository', () => ({
  incrementCampaignRedeemed: vi.fn(),
}))

import { merchantRedeemCoupon } from '@/application/merchant-redeem-coupon'
import {
  findCouponByCode,
  redeemCoupon,
  incrementCouponUses,
} from '@/infrastructure/supabase/repositories/coupon-repository'
import { createRedemption } from '@/infrastructure/supabase/repositories/coupon-redemption-repository'
import { createEvent } from '@/infrastructure/supabase/repositories/event-repository'
import { incrementCampaignRedeemed } from '@/infrastructure/supabase/repositories/campaign-repository'

function buildCoupon(overrides: Partial<Coupon> = {}): Coupon {
  return {
    id: 'c-1', restaurantId: 'r-1', type: 'promo', code: 'TEST01', status: 'active',
    memberId: 'm-1', expiresAt: null, redeemedAt: null, discountType: 'percentage',
    discountValue: 10, maxUses: null, currentUses: 0, isActive: true,
    title: null, description: null, campaignId: null, createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('merchantRedeemCoupon', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns not_found when coupon does not exist', async () => {
    vi.mocked(findCouponByCode).mockResolvedValue(null)

    const result = await merchantRedeemCoupon('BAD', 'r-1')

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toBe('not_found')
    }
  })

  it('returns wrong_restaurant when restaurant does not match', async () => {
    vi.mocked(findCouponByCode).mockResolvedValue(
      buildCoupon({ restaurantId: 'r-other' })
    )

    const result = await merchantRedeemCoupon('TEST01', 'r-1')

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toBe('wrong_restaurant')
    }
  })

  it('returns no_member when coupon has no memberId', async () => {
    vi.mocked(findCouponByCode).mockResolvedValue(
      buildCoupon({ memberId: null })
    )

    const result = await merchantRedeemCoupon('TEST01', 'r-1')

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toBe('no_member')
    }
  })

  it('returns not_redeemable when coupon is inactive', async () => {
    vi.mocked(findCouponByCode).mockResolvedValue(
      buildCoupon({ isActive: false })
    )

    const result = await merchantRedeemCoupon('TEST01', 'r-1')

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toBe('not_redeemable')
    }
  })

  it('handles shared coupon happy path', async () => {
    const coupon = buildCoupon({ type: 'shared', memberId: 'm-1' })
    vi.mocked(findCouponByCode).mockResolvedValue(coupon)

    const result = await merchantRedeemCoupon('TEST01', 'r-1')

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.coupon).toEqual(coupon)
      expect(result.message).toContain('10%')
    }
    expect(incrementCouponUses).toHaveBeenCalledWith('c-1')
    expect(createRedemption).toHaveBeenCalledWith('c-1', 'm-1', 'r-1')
    expect(createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: 'm-1', type: 'redeem' })
    )
    expect(redeemCoupon).not.toHaveBeenCalled()
  })

  it('handles personal coupon with campaignId', async () => {
    const coupon = buildCoupon({
      type: 'promo',
      memberId: 'm-1',
      campaignId: 'camp-1',
    })
    vi.mocked(findCouponByCode).mockResolvedValue(coupon)

    const result = await merchantRedeemCoupon('TEST01', 'r-1')

    expect(result.success).toBe(true)
    expect(redeemCoupon).toHaveBeenCalledWith('c-1')
    expect(incrementCouponUses).toHaveBeenCalledWith('c-1')
    expect(createRedemption).toHaveBeenCalledWith('c-1', 'm-1', 'r-1')
    expect(createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: 'm-1', type: 'redeem' })
    )
    expect(incrementCampaignRedeemed).toHaveBeenCalledWith('camp-1')
  })
})

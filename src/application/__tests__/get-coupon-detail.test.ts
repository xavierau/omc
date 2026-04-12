import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Coupon } from '@/domain/entities/coupon'

vi.mock('@/infrastructure/supabase/repositories/coupon-repository', () => ({
  findCouponById: vi.fn(),
}))

vi.mock('@/infrastructure/supabase/repositories/coupon-redemption-repository', () => ({
  getRedemptionCount: vi.fn(),
}))

import { getCouponDetailUseCase } from '@/application/get-coupon-detail'
import { findCouponById } from '@/infrastructure/supabase/repositories/coupon-repository'
import { getRedemptionCount } from '@/infrastructure/supabase/repositories/coupon-redemption-repository'

function buildCoupon(overrides: Partial<Coupon> = {}): Coupon {
  return {
    id: 'c-1', restaurantId: 'r-1', type: 'promo', code: 'SAVE10',
    status: 'active', memberId: null, expiresAt: null, redeemedAt: null,
    discountType: 'percentage', discountValue: 10, maxUses: null,
    currentUses: 0, isActive: true, title: null, description: null,
    campaignId: null, createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('getCouponDetailUseCase', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns failure when coupon is not found', async () => {
    vi.mocked(findCouponById).mockResolvedValue(null)

    const result = await getCouponDetailUseCase('c-99')

    expect(result).toEqual({ success: false, message: 'Coupon not found.' })
    expect(getRedemptionCount).not.toHaveBeenCalled()
  })

  it('returns coupon with redemption count on happy path', async () => {
    const coupon = buildCoupon()
    vi.mocked(findCouponById).mockResolvedValue(coupon)
    vi.mocked(getRedemptionCount).mockResolvedValue(5)

    const result = await getCouponDetailUseCase('c-1')

    expect(result).toEqual({
      success: true,
      data: { coupon, redemptionCount: 5 },
    })
    expect(findCouponById).toHaveBeenCalledWith('c-1')
    expect(getRedemptionCount).toHaveBeenCalledWith('c-1')
  })
})

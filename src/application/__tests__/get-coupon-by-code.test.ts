import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Coupon } from '@/domain/entities/coupon'

vi.mock('@/infrastructure/supabase/repositories/coupon-repository', () => ({
  findCouponByCode: vi.fn(),
}))

import { getCouponByCode } from '@/application/get-coupon-by-code'
import { findCouponByCode } from '@/infrastructure/supabase/repositories/coupon-repository'

function buildCoupon(overrides: Partial<Coupon> = {}): Coupon {
  return {
    id: 'c-1', restaurantId: 'r-1', type: 'promo', code: 'SAVE10',
    status: 'active', memberId: null, expiresAt: null, redeemedAt: null,
    discountType: 'percentage', discountValue: 10, maxUses: null,
    currentUses: 0, isActive: true, isChargeable: true, title: null, description: null,
    campaignId: null, createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('getCouponByCode', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns null when coupon is not found', async () => {
    vi.mocked(findCouponByCode).mockResolvedValue(null)

    const result = await getCouponByCode('MISSING')

    expect(result).toBeNull()
  })

  it('returns DTO with isExpired false for active coupon with future expiry', async () => {
    const futureDate = new Date(Date.now() + 86_400_000).toISOString()
    vi.mocked(findCouponByCode).mockResolvedValue(
      buildCoupon({ expiresAt: futureDate })
    )

    const result = await getCouponByCode('SAVE10')

    expect(result).toEqual(
      expect.objectContaining({
        code: 'SAVE10',
        isExpired: false,
        isRedeemed: false,
        discountType: 'percentage',
        discountValue: 10,
      })
    )
  })

  it('returns DTO with isExpired true and isRedeemed true for redeemed coupon with past expiry', async () => {
    const pastDate = new Date(Date.now() - 86_400_000).toISOString()
    vi.mocked(findCouponByCode).mockResolvedValue(
      buildCoupon({
        status: 'redeemed',
        expiresAt: pastDate,
      })
    )

    const result = await getCouponByCode('SAVE10')

    expect(result).toEqual(
      expect.objectContaining({
        isExpired: true,
        isRedeemed: true,
        status: 'redeemed',
      })
    )
  })
})

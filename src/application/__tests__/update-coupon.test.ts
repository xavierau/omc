import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Coupon } from '@/domain/entities/coupon'

vi.mock('@/infrastructure/supabase/repositories/coupon-repository', () => ({
  findCouponById: vi.fn(),
  updateCoupon: vi.fn(),
}))

import { updateCouponUseCase } from '@/application/update-coupon'
import {
  findCouponById,
  updateCoupon,
} from '@/infrastructure/supabase/repositories/coupon-repository'

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

describe('updateCouponUseCase', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns failure when coupon is not found', async () => {
    vi.mocked(findCouponById).mockResolvedValue(null)

    const result = await updateCouponUseCase({ id: 'c-99' })

    expect(result).toEqual({ success: false, message: 'Coupon not found.' })
    expect(updateCoupon).not.toHaveBeenCalled()
  })

  it('returns failure when discount value is negative', async () => {
    vi.mocked(findCouponById).mockResolvedValue(buildCoupon())

    const result = await updateCouponUseCase({
      id: 'c-1',
      discountValue: -1,
    })

    expect(result).toEqual({
      success: false,
      message: 'Discount value must be non-negative.',
    })
    expect(updateCoupon).not.toHaveBeenCalled()
  })

  it('returns failure when max uses is less than 1', async () => {
    vi.mocked(findCouponById).mockResolvedValue(buildCoupon())

    const result = await updateCouponUseCase({ id: 'c-1', maxUses: 0 })

    expect(result).toEqual({
      success: false,
      message: 'Max uses must be at least 1.',
    })
    expect(updateCoupon).not.toHaveBeenCalled()
  })

  it('updates coupon and returns success on happy path', async () => {
    const existing = buildCoupon()
    const updated = buildCoupon({ description: 'Updated' })
    vi.mocked(findCouponById).mockResolvedValue(existing)
    vi.mocked(updateCoupon).mockResolvedValue(updated)

    const result = await updateCouponUseCase({
      id: 'c-1',
      description: 'Updated',
    })

    expect(result).toEqual({ success: true, coupon: updated })
    expect(updateCoupon).toHaveBeenCalledWith('c-1', {
      description: 'Updated',
    })
  })
})

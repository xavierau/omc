import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Coupon } from '@/domain/entities/coupon'

vi.mock('@/infrastructure/supabase/repositories/coupon-repository', () => ({
  createCoupon: vi.fn(),
}))

import { createCouponUseCase } from '@/application/create-coupon'
import { createCoupon } from '@/infrastructure/supabase/repositories/coupon-repository'

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

function buildInput(overrides = {}) {
  return {
    restaurantId: 'r-1',
    type: 'promo' as const,
    code: 'SAVE10',
    ...overrides,
  }
}

describe('createCouponUseCase', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns failure for invalid coupon code format', async () => {
    const result = await createCouponUseCase(buildInput({ code: 'A!' }))

    expect(result).toEqual({
      success: false,
      message: 'Invalid coupon code format. Use 3-20 alphanumeric characters.',
    })
    expect(createCoupon).not.toHaveBeenCalled()
  })

  it('returns failure when discount value is negative', async () => {
    const result = await createCouponUseCase(
      buildInput({ discountValue: -5 })
    )

    expect(result).toEqual({
      success: false,
      message: 'Discount value must be non-negative.',
    })
    expect(createCoupon).not.toHaveBeenCalled()
  })

  it('returns failure when max uses is less than 1', async () => {
    const result = await createCouponUseCase(
      buildInput({ maxUses: 0 })
    )

    expect(result).toEqual({
      success: false,
      message: 'Max uses must be at least 1.',
    })
    expect(createCoupon).not.toHaveBeenCalled()
  })

  it('creates coupon with uppercased code on happy path', async () => {
    const coupon = buildCoupon()
    vi.mocked(createCoupon).mockResolvedValue(coupon)

    const result = await createCouponUseCase(
      buildInput({ code: 'save10' })
    )

    expect(result).toEqual({ success: true, coupon })
    expect(createCoupon).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'SAVE10', restaurantId: 'r-1' })
    )
  })

  it('passes validation when discount and maxUses are null', async () => {
    const coupon = buildCoupon()
    vi.mocked(createCoupon).mockResolvedValue(coupon)

    const result = await createCouponUseCase(
      buildInput({ discountValue: null, maxUses: null })
    )

    expect(result.success).toBe(true)
    expect(createCoupon).toHaveBeenCalled()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Coupon } from '@/domain/entities/coupon'

vi.mock('@/infrastructure/supabase/repositories/coupon-repository', () => ({
  findCouponByCode: vi.fn(),
  redeemCoupon: vi.fn(),
  incrementCouponUses: vi.fn(),
  decrementCouponUses: vi.fn(),
}))

vi.mock('@/infrastructure/supabase/repositories/coupon-redemption-repository', () => ({
  createRedemption: vi.fn(),
  hasRedeemed: vi.fn(),
}))

vi.mock('@/application/emit-event', () => ({
  emitEvent: vi.fn(),
}))

vi.mock('@/infrastructure/supabase/repositories/campaign-repository', () => ({
  incrementCampaignRedeemed: vi.fn(),
}))

import { redeemCouponUseCase } from '@/application/redeem-coupon'
import { Language } from '@/domain/value-objects/language'
import {
  findCouponByCode,
  redeemCoupon,
  incrementCouponUses,
  decrementCouponUses,
} from '@/infrastructure/supabase/repositories/coupon-repository'
import {
  createRedemption,
  hasRedeemed,
} from '@/infrastructure/supabase/repositories/coupon-redemption-repository'
import { emitEvent } from '@/application/emit-event'
import { incrementCampaignRedeemed } from '@/infrastructure/supabase/repositories/campaign-repository'

function buildCoupon(overrides: Partial<Coupon> = {}): Coupon {
  return {
    id: 'c-1', restaurantId: 'r-1', type: 'promo', code: 'TEST01', status: 'active',
    memberId: 'm-1', expiresAt: null, redeemedAt: null, discountType: 'percentage',
    discountValue: 10, maxUses: null, currentUses: 0, isActive: true, isChargeable: true,
    title: null, description: null, campaignId: null, createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('redeemCouponUseCase', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns failure when coupon is not found', async () => {
    vi.mocked(findCouponByCode).mockResolvedValue(null)

    const result = await redeemCouponUseCase('BAD', 'm-1', undefined, Language.EN)

    expect(result).toEqual({
      success: false,
      message: "That code doesn't look right. Please check and try again.",
    })
  })

  it('returns failure when coupon is inactive', async () => {
    vi.mocked(findCouponByCode).mockResolvedValue(
      buildCoupon({ isActive: false })
    )

    const result = await redeemCouponUseCase('TEST01', 'm-1', undefined, Language.EN)

    expect(result.success).toBe(false)
    expect(result.message).toContain('no longer active')
  })

  it('returns failure when coupon is expired', async () => {
    vi.mocked(findCouponByCode).mockResolvedValue(
      buildCoupon({ expiresAt: '2020-01-01T00:00:00Z' })
    )

    const result = await redeemCouponUseCase('TEST01', 'm-1', undefined, Language.EN)

    expect(result.success).toBe(false)
    expect(result.message).toContain('expired')
  })

  it('returns failure when max uses reached', async () => {
    vi.mocked(findCouponByCode).mockResolvedValue(
      buildCoupon({ maxUses: 5, currentUses: 5 })
    )

    const result = await redeemCouponUseCase('TEST01', 'm-1', undefined, Language.EN)

    expect(result.success).toBe(false)
    expect(result.message).toContain('maximum uses')
  })

  it('returns failure when shared coupon already redeemed by member', async () => {
    vi.mocked(findCouponByCode).mockResolvedValue(
      buildCoupon({ type: 'shared' })
    )
    vi.mocked(hasRedeemed).mockResolvedValue(true)

    const result = await redeemCouponUseCase('TEST01', 'm-1', undefined, Language.EN)

    expect(result).toEqual({
      success: false,
      message: 'You have already used this coupon.',
    })
  })

  it('handles shared coupon happy path', async () => {
    const coupon = buildCoupon({ type: 'shared' })
    vi.mocked(findCouponByCode).mockResolvedValue(coupon)
    vi.mocked(hasRedeemed).mockResolvedValue(false)

    const result = await redeemCouponUseCase('TEST01', 'm-1', undefined, Language.EN)

    expect(result.success).toBe(true)
    expect(result.message).toContain('10% off')
    expect(incrementCouponUses).toHaveBeenCalledWith('c-1')
    expect(createRedemption).toHaveBeenCalledWith('c-1', 'm-1', 'r-1')
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: 'm-1', type: 'redeem' })
    )
  })

  it('decrements uses on duplicate key error for shared coupon', async () => {
    vi.mocked(findCouponByCode).mockResolvedValue(
      buildCoupon({ type: 'shared' })
    )
    vi.mocked(hasRedeemed).mockResolvedValue(false)
    vi.mocked(createRedemption).mockRejectedValue(
      new Error('duplicate key value violates unique constraint')
    )

    const result = await redeemCouponUseCase('TEST01', 'm-1', undefined, Language.EN)

    expect(decrementCouponUses).toHaveBeenCalledWith('c-1')
    expect(result).toEqual({
      success: false,
      message: 'You have already used this coupon.',
    })
  })

  it('handles personal coupon happy path', async () => {
    const coupon = buildCoupon({ type: 'promo' })
    vi.mocked(findCouponByCode).mockResolvedValue(coupon)

    const result = await redeemCouponUseCase('TEST01', 'm-1', undefined, Language.EN)

    expect(result.success).toBe(true)
    expect(redeemCoupon).toHaveBeenCalledWith('c-1')
    expect(incrementCouponUses).toHaveBeenCalledWith('c-1')
    expect(createRedemption).toHaveBeenCalledWith('c-1', 'm-1', 'r-1')
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: 'm-1', type: 'redeem' })
    )
  })

  it('calls incrementCampaignRedeemed for personal coupon with campaignId', async () => {
    vi.mocked(findCouponByCode).mockResolvedValue(
      buildCoupon({ campaignId: 'camp-1' })
    )

    await redeemCouponUseCase('TEST01', 'm-1', undefined, Language.EN)

    expect(incrementCampaignRedeemed).toHaveBeenCalledWith('camp-1')
  })

  it('includes dollar sign in success message for fixed_amount discount', async () => {
    vi.mocked(findCouponByCode).mockResolvedValue(
      buildCoupon({ discountType: 'fixed_amount', discountValue: 20 })
    )

    const result = await redeemCouponUseCase('TEST01', 'm-1', undefined, Language.EN)

    expect(result.success).toBe(true)
    expect(result.message).toContain('$20')
  })

  // ONBOARD-008: localized copy
  describe('localized copy (ONBOARD-008)', () => {
    it('ZH: returns ZH failure message when coupon is not found', async () => {
      vi.mocked(findCouponByCode).mockResolvedValue(null)

      const result = await redeemCouponUseCase('BAD', 'm-1', undefined, Language.ZH_HK)

      expect(result.success).toBe(false)
      expect(result.message).toContain('代碼')
    })

    it('ZH: returns ZH failure for inactive coupon', async () => {
      vi.mocked(findCouponByCode).mockResolvedValue(
        buildCoupon({ isActive: false })
      )

      const result = await redeemCouponUseCase('TEST01', 'm-1', undefined, Language.ZH_HK)

      expect(result.message).toContain('失效')
    })

    it('ZH: returns ZH failure for expired coupon', async () => {
      vi.mocked(findCouponByCode).mockResolvedValue(
        buildCoupon({ expiresAt: '2020-01-01T00:00:00Z' })
      )

      const result = await redeemCouponUseCase('TEST01', 'm-1', undefined, Language.ZH_HK)

      expect(result.message).toContain('過期')
    })

    it('ZH: returns ZH failure when shared coupon already redeemed', async () => {
      vi.mocked(findCouponByCode).mockResolvedValue(
        buildCoupon({ type: 'shared' })
      )
      vi.mocked(hasRedeemed).mockResolvedValue(true)

      const result = await redeemCouponUseCase('TEST01', 'm-1', undefined, Language.ZH_HK)

      expect(result.success).toBe(false)
      expect(result.message).toContain('已使用')
    })

    it('ZH: success message for percentage discount uses 折扣', async () => {
      vi.mocked(findCouponByCode).mockResolvedValue(
        buildCoupon({ discountType: 'percentage', discountValue: 15 })
      )

      const result = await redeemCouponUseCase('TEST01', 'm-1', undefined, Language.ZH_HK)

      expect(result.success).toBe(true)
      expect(result.message).toContain('15%')
      expect(result.message).toMatch(/折扣|優惠/)
    })

    it('ZH: success message for fixed discount includes $ amount', async () => {
      vi.mocked(findCouponByCode).mockResolvedValue(
        buildCoupon({ discountType: 'fixed_amount', discountValue: 20 })
      )

      const result = await redeemCouponUseCase('TEST01', 'm-1', undefined, Language.ZH_HK)

      expect(result.success).toBe(true)
      expect(result.message).toContain('$20')
    })
  })
})

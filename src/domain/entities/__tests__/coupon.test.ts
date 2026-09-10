import { describe, it, expect } from 'vitest'
import {
  isSharedCoupon,
  isCouponRedeemable,
  type Coupon,
} from '@/domain/entities/coupon'

function buildCoupon(overrides: Partial<Coupon> = {}): Coupon {
  return {
    id: 'cpn-1',
    restaurantId: 'rest-1',
    type: 'welcome',
    code: 'ABC123',
    status: 'active',
    memberId: null,
    expiresAt: null,
    redeemedAt: null,
    discountType: 'percentage',
    discountValue: 10,
    maxUses: null,
    currentUses: 0,
    isActive: true,
    title: null,
    description: null,
    campaignId: null,
    isChargeable: true,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('isSharedCoupon', () => {
  it('returns true for type shared', () => {
    expect(isSharedCoupon(buildCoupon({ type: 'shared' }))).toBe(true)
  })

  it.each(['welcome', 'promo', 'reward'] as const)(
    'returns false for type %s',
    (type) => {
      expect(isSharedCoupon(buildCoupon({ type }))).toBe(false)
    }
  )
})

describe('isCouponRedeemable', () => {
  it('returns true when active with no expiry and no max uses', () => {
    expect(isCouponRedeemable(buildCoupon())).toBe(true)
  })

  it('returns false when isActive is false', () => {
    const coupon = buildCoupon({ isActive: false })
    expect(isCouponRedeemable(coupon)).toBe(false)
  })

  it('returns false when expired', () => {
    const coupon = buildCoupon({
      expiresAt: '2020-01-01T00:00:00Z',
    })
    expect(isCouponRedeemable(coupon)).toBe(false)
  })

  it('returns false when currentUses >= maxUses', () => {
    const coupon = buildCoupon({ maxUses: 5, currentUses: 5 })
    expect(isCouponRedeemable(coupon)).toBe(false)
  })

  it('returns true for shared coupon with redeemed status', () => {
    const coupon = buildCoupon({
      type: 'shared',
      status: 'redeemed',
    })
    expect(isCouponRedeemable(coupon)).toBe(true)
  })

  it('returns false for non-shared coupon with redeemed status', () => {
    const coupon = buildCoupon({
      type: 'welcome',
      status: 'redeemed',
    })
    expect(isCouponRedeemable(coupon)).toBe(false)
  })

  it('returns true when active with future expiry and uses below max', () => {
    const coupon = buildCoupon({
      expiresAt: '2099-12-31T23:59:59Z',
      maxUses: 10,
      currentUses: 3,
    })
    expect(isCouponRedeemable(coupon)).toBe(true)
  })
})

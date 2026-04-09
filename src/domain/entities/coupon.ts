export interface Coupon {
  id: string
  restaurantId: string
  type: 'welcome' | 'promo' | 'reward' | 'shared'
  code: string
  status: 'active' | 'redeemed' | 'expired'
  memberId: string | null
  expiresAt: string | null
  redeemedAt: string | null
  discountType: 'percentage' | 'fixed_amount' | null
  discountValue: number | null
  maxUses: number | null
  currentUses: number
  isActive: boolean
  title: string | null
  description: string | null
  campaignId: string | null
  createdAt: string
}

export function isSharedCoupon(coupon: Coupon): boolean {
  return coupon.type === 'shared'
}

export function isCouponRedeemable(coupon: Coupon): boolean {
  if (!coupon.isActive) return false
  if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) {
    return false
  }
  if (coupon.maxUses !== null && coupon.currentUses >= coupon.maxUses) {
    return false
  }
  if (!isSharedCoupon(coupon) && coupon.status !== 'active') {
    return false
  }
  return true
}

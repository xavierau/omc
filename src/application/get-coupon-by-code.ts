import { findCouponByCode } from '@/infrastructure/supabase/repositories/coupon-repository'

export interface CouponPublicDTO {
  code: string
  discountType: 'percentage' | 'fixed_amount' | null
  discountValue: number | null
  expiresAt: string | null
  status: 'active' | 'redeemed' | 'expired'
  isExpired: boolean
  isRedeemed: boolean
  title: string | null
  description: string | null
}

export async function getCouponByCode(
  code: string
): Promise<CouponPublicDTO | null> {
  const coupon = await findCouponByCode(code)
  if (!coupon) return null

  const now = new Date()
  const isExpired = coupon.expiresAt
    ? new Date(coupon.expiresAt) < now
    : false
  const isRedeemed = coupon.status === 'redeemed'

  return {
    code: coupon.code,
    discountType: coupon.discountType,
    discountValue: coupon.discountValue,
    expiresAt: coupon.expiresAt,
    status: coupon.status,
    isExpired,
    isRedeemed,
    title: coupon.title,
    description: coupon.description,
  }
}

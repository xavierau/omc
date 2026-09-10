import { Coupon } from '@/domain/entities/coupon'
import { findCouponById } from '@/infrastructure/supabase/repositories/coupon-repository'
import { getRedemptionCount } from '@/infrastructure/supabase/repositories/coupon-redemption-repository'

export interface CouponDetail {
  coupon: Coupon
  redemptionCount: number
}

export type GetCouponDetailResult =
  | { success: true; data: CouponDetail }
  | { success: false; message: string }

export async function getCouponDetailUseCase(
  couponId: string
): Promise<GetCouponDetailResult> {
  const coupon = await findCouponById(couponId)
  if (!coupon) {
    return { success: false, message: 'Coupon not found.' }
  }

  const redemptionCount = await getRedemptionCount(couponId)

  return {
    success: true,
    data: { coupon, redemptionCount },
  }
}

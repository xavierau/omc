import {
  findCouponByCode,
  redeemCoupon,
  incrementCouponUses,
  decrementCouponUses,
} from '@/infrastructure/supabase/repositories/coupon-repository'
import { createRedemption, hasRedeemed } from '@/infrastructure/supabase/repositories/coupon-redemption-repository'
import { createEvent } from '@/infrastructure/supabase/repositories/event-repository'
import { isCouponRedeemable, isSharedCoupon } from '@/domain/entities/coupon'

export type RedeemResult =
  | { success: true; message: string }
  | { success: false; message: string }

export async function redeemCouponUseCase(
  code: string,
  memberId: string,
  restaurantId?: string
): Promise<RedeemResult> {
  const coupon = await findCouponByCode(code)

  if (!coupon) {
    return { success: false, message: "That code doesn't look right. Please check and try again." }
  }

  if (!isCouponRedeemable(coupon)) {
    return { success: false, message: resolveNotRedeemableMessage(coupon) }
  }

  if (isSharedCoupon(coupon)) {
    return handleSharedRedemption(coupon, memberId, restaurantId)
  }

  return handlePersonalRedemption(coupon, memberId, restaurantId)
}

function resolveNotRedeemableMessage(coupon: { isActive: boolean; expiresAt: string | null; maxUses: number | null; currentUses: number; status: string }): string {
  if (!coupon.isActive) return 'This coupon is no longer active.'
  if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) return 'This coupon has expired.'
  if (coupon.maxUses !== null && coupon.currentUses >= coupon.maxUses) return 'This coupon has reached its maximum uses.'
  if (coupon.status === 'redeemed') return 'This coupon has already been used.'
  return 'This coupon cannot be redeemed.'
}

async function handleSharedRedemption(
  coupon: { id: string; restaurantId: string; code: string; type: string; discountType: string | null; discountValue: number | null },
  memberId: string,
  restaurantId?: string
): Promise<RedeemResult> {
  const alreadyRedeemed = await hasRedeemed(coupon.id, memberId)
  if (alreadyRedeemed) {
    return { success: false, message: 'You have already used this coupon.' }
  }

  await incrementCouponUses(coupon.id)
  try {
    await createRedemption(coupon.id, memberId, restaurantId ?? coupon.restaurantId)
  } catch (err) {
    await decrementCouponUses(coupon.id)
    if ((err as Error).message.includes('unique') || (err as Error).message.includes('duplicate')) {
      return { success: false, message: 'You have already used this coupon.' }
    }
    throw err
  }
  await createEvent({
    restaurantId: restaurantId ?? coupon.restaurantId,
    memberId,
    type: 'redeem',
    dataJson: { coupon_code: coupon.code, coupon_type: coupon.type },
  })

  return { success: true, message: buildSuccessMessage(coupon) }
}

async function handlePersonalRedemption(
  coupon: { id: string; restaurantId: string; code: string; type: string; discountType: string | null; discountValue: number | null },
  memberId: string,
  restaurantId?: string
): Promise<RedeemResult> {
  await redeemCoupon(coupon.id)
  await incrementCouponUses(coupon.id)
  await createRedemption(coupon.id, memberId, restaurantId ?? coupon.restaurantId)
  await createEvent({
    restaurantId: restaurantId ?? coupon.restaurantId,
    memberId,
    type: 'redeem',
    dataJson: { coupon_code: coupon.code, coupon_type: coupon.type },
  })

  return { success: true, message: buildSuccessMessage(coupon) }
}

function buildSuccessMessage(coupon: { discountType: string | null; discountValue: number | null }): string {
  if (coupon.discountType === 'percentage' && coupon.discountValue) {
    return `Coupon redeemed! You get ${coupon.discountValue}% off!`
  }
  if (coupon.discountType === 'fixed_amount' && coupon.discountValue) {
    return `Coupon redeemed! You get $${coupon.discountValue} off!`
  }
  return 'Coupon redeemed! Enjoy your reward!'
}

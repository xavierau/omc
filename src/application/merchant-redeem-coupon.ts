import {
  findCouponByCode,
  redeemCoupon,
  incrementCouponUses,
} from '@/infrastructure/supabase/repositories/coupon-repository'
import { createRedemption } from '@/infrastructure/supabase/repositories/coupon-redemption-repository'
import { createEvent } from '@/infrastructure/supabase/repositories/event-repository'
import { incrementCampaignRedeemed } from '@/infrastructure/supabase/repositories/campaign-repository'
import { Coupon, isCouponRedeemable, isSharedCoupon } from '@/domain/entities/coupon'

export type MerchantRedeemResult =
  | { success: true; message: string; coupon: Coupon }
  | { success: false; error: string; message: string }

export async function merchantRedeemCoupon(
  code: string,
  restaurantId: string
): Promise<MerchantRedeemResult> {
  const coupon = await findCouponByCode(code)

  if (!coupon) {
    return { success: false, error: 'not_found', message: 'Coupon not found.' }
  }

  if (coupon.restaurantId !== restaurantId) {
    return { success: false, error: 'wrong_restaurant', message: 'This coupon belongs to another restaurant.' }
  }

  if (!coupon.memberId) {
    return { success: false, error: 'no_member', message: 'This coupon is not assigned to any member.' }
  }

  if (!isCouponRedeemable(coupon)) {
    return { success: false, error: resolveErrorCode(coupon), message: resolveNotRedeemableMessage(coupon) }
  }

  if (isSharedCoupon(coupon)) {
    return handleSharedRedemption(coupon, restaurantId)
  }

  return handlePersonalRedemption(coupon, restaurantId)
}

function resolveErrorCode(coupon: Coupon): string {
  if (!coupon.isActive) return 'not_redeemable'
  if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) return 'expired'
  if (coupon.status === 'redeemed') return 'already_redeemed'
  if (coupon.maxUses !== null && coupon.currentUses >= coupon.maxUses) return 'not_redeemable'
  return 'not_redeemable'
}

function resolveNotRedeemableMessage(coupon: Coupon): string {
  if (!coupon.isActive) return 'This coupon is no longer active.'
  if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) return 'This coupon has expired.'
  if (coupon.status === 'redeemed') return 'This coupon has already been used.'
  if (coupon.maxUses !== null && coupon.currentUses >= coupon.maxUses) return 'This coupon has reached its maximum uses.'
  return 'This coupon cannot be redeemed.'
}

async function handleSharedRedemption(
  coupon: Coupon,
  restaurantId: string
): Promise<MerchantRedeemResult> {
  await incrementCouponUses(coupon.id)
  await createRedemption(coupon.id, coupon.memberId!, restaurantId)
  await createRedemptionEvent(coupon, restaurantId)
  if (coupon.campaignId) {
    await incrementCampaignRedeemed(coupon.campaignId)
  }
  return { success: true, message: buildSuccessMessage(coupon), coupon }
}

async function handlePersonalRedemption(
  coupon: Coupon,
  restaurantId: string
): Promise<MerchantRedeemResult> {
  await redeemCoupon(coupon.id)
  await incrementCouponUses(coupon.id)
  await createRedemption(coupon.id, coupon.memberId!, restaurantId)
  await createRedemptionEvent(coupon, restaurantId)
  if (coupon.campaignId) {
    await incrementCampaignRedeemed(coupon.campaignId)
  }
  return { success: true, message: buildSuccessMessage(coupon), coupon }
}

async function createRedemptionEvent(coupon: Coupon, restaurantId: string): Promise<void> {
  await createEvent({
    restaurantId,
    memberId: coupon.memberId,
    type: 'merchant_redeem',
    dataJson: { coupon_code: coupon.code, coupon_type: coupon.type },
  })
}

function buildSuccessMessage(coupon: Coupon): string {
  if (coupon.discountType === 'percentage' && coupon.discountValue) {
    return `Coupon redeemed! ${coupon.discountValue}% off applied.`
  }
  if (coupon.discountType === 'fixed_amount' && coupon.discountValue) {
    return `Coupon redeemed! $${coupon.discountValue} off applied.`
  }
  return 'Coupon redeemed successfully!'
}

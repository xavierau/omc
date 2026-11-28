import {
  findCouponByCode,
  redeemCoupon,
  incrementCouponUses,
  decrementCouponUses,
} from '@/infrastructure/supabase/repositories/coupon-repository'
import { createRedemption, hasRedeemed } from '@/infrastructure/supabase/repositories/coupon-redemption-repository'
import { emitEvent } from '@/application/emit-event'
import { incrementCampaignRedeemed } from '@/infrastructure/supabase/repositories/campaign-repository'
import { isCouponRedeemable, isSharedCoupon } from '@/domain/entities/coupon'
import { Language } from '@/domain/value-objects/language'
import {
  couponNotFoundMessage,
  couponInactiveMessage,
  couponExpiredMessage,
  couponMaxUsesMessage,
  couponAlreadyUsedMessage,
  couponSuccessMessage,
} from './messages/redeem-coupon-messages'

export type RedeemResult =
  | { success: true; message: string }
  | { success: false; message: string }

type CouponForRedemption = {
  id: string
  restaurantId: string
  code: string
  type: string
  campaignId: string | null
  discountType: string | null
  discountValue: number | null
}

export async function redeemCouponUseCase(
  code: string,
  memberId: string,
  restaurantId?: string,
  language: Language = Language.default()
): Promise<RedeemResult> {
  const coupon = await findCouponByCode(code)

  if (!coupon) {
    return { success: false, message: couponNotFoundMessage(language) }
  }

  if (!isCouponRedeemable(coupon)) {
    return { success: false, message: resolveNotRedeemableMessage(coupon, language) }
  }

  if (isSharedCoupon(coupon)) {
    return handleSharedRedemption(coupon, memberId, language, restaurantId)
  }

  return handlePersonalRedemption(coupon, memberId, language, restaurantId)
}

function resolveNotRedeemableMessage(
  coupon: { isActive: boolean; expiresAt: string | null; maxUses: number | null; currentUses: number; status: string },
  language: Language
): string {
  if (!coupon.isActive) return couponInactiveMessage(language)
  if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) return couponExpiredMessage(language)
  if (coupon.maxUses !== null && coupon.currentUses >= coupon.maxUses) return couponMaxUsesMessage(language)
  if (coupon.status === 'redeemed') return couponAlreadyUsedMessage(language)
  return couponInactiveMessage(language)
}

async function handleSharedRedemption(
  coupon: CouponForRedemption,
  memberId: string,
  language: Language,
  restaurantId?: string
): Promise<RedeemResult> {
  const alreadyRedeemed = await hasRedeemed(coupon.id, memberId)
  if (alreadyRedeemed) {
    return { success: false, message: couponAlreadyUsedMessage(language) }
  }

  await incrementCouponUses(coupon.id)
  try {
    await createRedemption(coupon.id, memberId, restaurantId ?? coupon.restaurantId)
  } catch (err) {
    await decrementCouponUses(coupon.id)
    if ((err as Error).message.includes('unique') || (err as Error).message.includes('duplicate')) {
      return { success: false, message: couponAlreadyUsedMessage(language) }
    }
    throw err
  }
  await recordRedeemSideEffects(coupon, memberId, restaurantId)
  return { success: true, message: couponSuccessMessage(language, coupon) }
}

async function handlePersonalRedemption(
  coupon: CouponForRedemption,
  memberId: string,
  language: Language,
  restaurantId?: string
): Promise<RedeemResult> {
  await redeemCoupon(coupon.id)
  await incrementCouponUses(coupon.id)
  await createRedemption(coupon.id, memberId, restaurantId ?? coupon.restaurantId)
  await recordRedeemSideEffects(coupon, memberId, restaurantId)
  return { success: true, message: couponSuccessMessage(language, coupon) }
}

async function recordRedeemSideEffects(
  coupon: CouponForRedemption,
  memberId: string,
  restaurantId: string | undefined
): Promise<void> {
  await emitEvent({
    restaurantId: restaurantId ?? coupon.restaurantId,
    memberId,
    type: 'redeem',
    dataJson: { coupon_code: coupon.code, coupon_type: coupon.type },
  })
  if (coupon.campaignId) {
    await incrementCampaignRedeemed(coupon.campaignId)
  }
}

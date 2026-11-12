// Shared reward mint + QR-upload + WhatsApp send core, extracted from
// redeem-reward.ts so a no-points stamp completion (§6) can reuse it. Raw-send
// precedent (sendTextMessage + sendImageMessage), NO marketing-cap check — a
// completed-reward coupon is transactional/utility (§7).
//
// The celebration text is the ONLY part that differs by source: the points path
// keeps the balance-bearing copy; the stamp_campaign path uses the no-points
// variant (a stamp completion has no pointsCost/newBalance).
import { createCoupon } from '@/infrastructure/supabase/repositories/coupon-repository'
import { generateCouponCode } from '@/domain/value-objects/coupon-code'
import { uploadCouponQr } from '@/infrastructure/supabase/storage'
import { sendTextMessage, sendImageMessage } from '@/infrastructure/whatsapp/messaging'
import { Language } from '@/domain/value-objects/language'
import {
  rewardRedeemedCelebration,
  stampRewardUnlockedCelebration,
  rewardQrCaption,
} from './messages/redeem-reward-messages'

const MAX_CODE_ATTEMPTS = 3

export interface MintRewardRecord {
  id: string
  name: string
  pointsCost: number
  discountType: 'percentage' | 'fixed_amount'
  discountValue: number
  couponExpiryDays: number
}

export type RewardSource = 'points' | 'stamp_campaign'

export interface MintAndDeliverRewardParams {
  reward: MintRewardRecord
  restaurantId: string
  memberId: string
  phone: string
  phoneNumberId: string
  language: Language
  source: RewardSource
  newBalance?: number // present only for source='points'
}

export async function mintAndDeliverReward(
  params: MintAndDeliverRewardParams
): Promise<string> {
  const code = await mintCoupon(params)
  await deliver(params, code)
  return code
}

async function mintCoupon(params: MintAndDeliverRewardParams): Promise<string> {
  const { reward } = params
  const expiresAt = new Date(
    Date.now() + reward.couponExpiryDays * 86_400_000
  ).toISOString()
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateCouponCode()
    try {
      await createCoupon(buildCouponParams(params, code, expiresAt))
      return code
    } catch (err) {
      if (!(err as Error).message.includes('unique')) throw err
    }
  }
  throw new Error('Failed to generate unique coupon code after 3 attempts')
}

function buildCouponParams(
  params: MintAndDeliverRewardParams,
  code: string,
  expiresAt: string
) {
  return {
    restaurantId: params.restaurantId,
    type: 'reward' as const,
    code,
    memberId: params.memberId,
    expiresAt,
    maxUses: 1,
    discountType: params.reward.discountType,
    discountValue: params.reward.discountValue,
    description: params.reward.name,
  }
}

async function deliver(
  params: MintAndDeliverRewardParams,
  code: string
): Promise<void> {
  const text = celebrationText(params, code)
  await sendTextMessage(params.phoneNumberId, params.phone, text)
  const qrUrl = await uploadCouponQr(code)
  await sendImageMessage(
    params.phoneNumberId,
    params.phone,
    qrUrl,
    rewardQrCaption(params.language, { code })
  )
}

function celebrationText(
  params: MintAndDeliverRewardParams,
  code: string
): string {
  const { reward, language } = params
  if (params.source === 'stamp_campaign') {
    return stampRewardUnlockedCelebration(language, {
      name: reward.name,
      discountType: reward.discountType,
      discountValue: reward.discountValue,
      code,
    })
  }
  return rewardRedeemedCelebration(language, {
    name: reward.name,
    pointsCost: reward.pointsCost,
    discountType: reward.discountType,
    discountValue: reward.discountValue,
    code,
    newBalance: params.newBalance ?? 0,
  })
}

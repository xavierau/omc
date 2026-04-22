import { getRewardById } from '@/infrastructure/supabase/repositories/reward-repository'
import { createCoupon } from '@/infrastructure/supabase/repositories/coupon-repository'
import { generateCouponCode } from '@/domain/value-objects/coupon-code'
import { uploadCouponQr } from '@/infrastructure/supabase/storage'
import { sendTextMessage, sendImageMessage } from '@/infrastructure/whatsapp/messaging'
import { emitEvent } from '@/application/emit-event'
import { adjustMemberPoints } from '@/infrastructure/supabase/repositories/member-repository'
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { Language } from '@/domain/value-objects/language'
import {
  rewardNotFoundMessage,
  rewardInsufficientPointsMessage,
  rewardRedeemedCelebration,
  rewardQrCaption,
} from './messages/redeem-reward-messages'

export type RedeemRewardResult =
  | { success: true; couponCode: string }
  | { success: false; message: string }

const MAX_CODE_ATTEMPTS = 3

type RewardRecord = {
  id: string
  name: string
  pointsCost: number
  isActive: boolean
  discountType: 'percentage' | 'fixed_amount'
  discountValue: number
  couponExpiryDays: number
}

export interface RedeemRewardParams {
  memberId: string
  rewardId: string
  restaurantId: string
  phone: string
  phoneNumberId: string
  language?: Language
}

export async function redeemRewardUseCase(
  params: RedeemRewardParams
): Promise<RedeemRewardResult> {
  const language = params.language ?? Language.default()
  const reward = await getRewardById(params.rewardId)
  if (!reward || !reward.isActive) {
    return { success: false, message: rewardNotFoundMessage(language) }
  }

  const balance = await getMemberBalance(params.memberId)
  if (balance < reward.pointsCost) {
    return {
      success: false,
      message: rewardInsufficientPointsMessage(language, { balance, cost: reward.pointsCost }),
    }
  }

  const newBalance = await adjustMemberPoints(params.memberId, -reward.pointsCost, { rejectNegative: true })
  const code = await createRewardCoupon(reward, params)
  await notifyMember({ ...params, reward, code, newBalance, language })
  await logRewardEvent(params, reward, code)
  return { success: true, couponCode: code }
}

async function getMemberBalance(memberId: string): Promise<number> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase.from('members').select('points_balance').eq('id', memberId).single()
  if (error || !data) throw new Error(`Member not found: ${memberId}`)
  return data.points_balance
}

async function createRewardCoupon(
  reward: RewardRecord,
  params: { restaurantId: string; memberId: string }
): Promise<string> {
  const expiresAt = new Date(Date.now() + reward.couponExpiryDays * 86_400_000).toISOString()
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateCouponCode()
    try {
      await createCoupon({
        restaurantId: params.restaurantId,
        type: 'reward',
        code,
        memberId: params.memberId,
        expiresAt,
        maxUses: 1,
        discountType: reward.discountType,
        discountValue: reward.discountValue,
        description: reward.name,
      })
      return code
    } catch (err) {
      if (!(err as Error).message.includes('unique')) throw err
    }
  }
  throw new Error('Failed to generate unique coupon code after 3 attempts')
}

async function notifyMember(p: {
  phone: string
  phoneNumberId: string
  reward: RewardRecord
  code: string
  newBalance: number
  language: Language
}): Promise<void> {
  const text = rewardRedeemedCelebration(p.language, {
    name: p.reward.name,
    pointsCost: p.reward.pointsCost,
    discountType: p.reward.discountType,
    discountValue: p.reward.discountValue,
    code: p.code,
    newBalance: p.newBalance,
  })
  await sendTextMessage(p.phoneNumberId, p.phone, text)
  const qrUrl = await uploadCouponQr(p.code)
  await sendImageMessage(p.phoneNumberId, p.phone, qrUrl, rewardQrCaption(p.language, { code: p.code }))
}

async function logRewardEvent(
  params: { restaurantId: string; memberId: string; rewardId: string },
  reward: { name: string; pointsCost: number },
  code: string
): Promise<void> {
  await emitEvent({
    restaurantId: params.restaurantId,
    memberId: params.memberId,
    type: 'reward_redeem',
    dataJson: {
      reward_id: params.rewardId,
      reward_name: reward.name,
      points_spent: reward.pointsCost,
      coupon_code: code,
    },
  })
}

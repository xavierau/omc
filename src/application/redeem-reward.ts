import { getRewardById } from '@/infrastructure/supabase/repositories/reward-repository'
import { createCoupon } from '@/infrastructure/supabase/repositories/coupon-repository'
import { generateCouponCode } from '@/domain/value-objects/coupon-code'
import { uploadCouponQr } from '@/infrastructure/supabase/storage'
import { sendTextMessage, sendImageMessage } from '@/infrastructure/whatsapp/messaging'
import { createEvent } from '@/infrastructure/supabase/repositories/event-repository'
import { deductMemberPoints } from '@/infrastructure/supabase/repositories/member-repository'
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'

export type RedeemRewardResult =
  | { success: true; couponCode: string }
  | { success: false; message: string }

const MAX_CODE_ATTEMPTS = 3

export async function redeemRewardUseCase(params: {
  memberId: string
  rewardId: string
  restaurantId: string
  phone: string
  phoneNumberId: string
}): Promise<RedeemRewardResult> {
  const reward = await getRewardById(params.rewardId)
  if (!reward || !reward.isActive) {
    return { success: false, message: 'Reward not found.' }
  }

  const pointsBalance = await getMemberBalance(params.memberId)
  if (pointsBalance < reward.pointsCost) {
    return {
      success: false,
      message: `Not enough points. You have ${pointsBalance} points but need ${reward.pointsCost}.`,
    }
  }

  const newBalance = await deductMemberPoints(params.memberId, reward.pointsCost)
  const code = await createRewardCoupon(reward, params)

  await notifyMember(params, reward, code, newBalance)
  await logRewardEvent(params, reward, code)

  return { success: true, couponCode: code }
}

async function getMemberBalance(memberId: string): Promise<number> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('members')
    .select('points_balance')
    .eq('id', memberId)
    .single()

  if (error || !data) throw new Error(`Member not found: ${memberId}`)
  return data.points_balance
}

async function createRewardCoupon(
  reward: { pointsCost: number; couponExpiryDays: number; discountType: 'percentage' | 'fixed_amount'; discountValue: number; name: string },
  params: { restaurantId: string; memberId: string }
): Promise<string> {
  const expiresAt = new Date(
    Date.now() + reward.couponExpiryDays * 24 * 60 * 60 * 1000
  ).toISOString()

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

function formatDiscountText(reward: { name: string; pointsCost: number; discountType: string; discountValue: number }, code: string, newBalance: number): string {
  const prefix = reward.discountType === 'fixed_amount' ? 'HK$' : ''
  const suffix = reward.discountType === 'percentage' ? '%' : ''
  const discount = `${prefix}${reward.discountValue}${suffix}`

  return [
    `\u{1F389} You redeemed ${reward.name} (${discount} off) for ${reward.pointsCost} points!`,
    `Your code: *${code}*`,
    `New balance: ${newBalance} points`,
  ].join('\n')
}

async function notifyMember(
  params: { phone: string; phoneNumberId: string },
  reward: { name: string; pointsCost: number; discountType: string; discountValue: number },
  code: string,
  newBalance: number
): Promise<void> {
  const text = formatDiscountText(reward, code, newBalance)
  await sendTextMessage(params.phoneNumberId, params.phone, text)

  const qrUrl = await uploadCouponQr(code)
  await sendImageMessage(params.phoneNumberId, params.phone, qrUrl, `Your code: ${code}`)
}

async function logRewardEvent(
  params: { restaurantId: string; memberId: string; rewardId: string },
  reward: { name: string; pointsCost: number },
  code: string
): Promise<void> {
  await createEvent({
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

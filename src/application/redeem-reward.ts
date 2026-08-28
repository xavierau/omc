import { getRewardById } from '@/infrastructure/supabase/repositories/reward-repository'
import { emitEvent } from '@/application/emit-event'
import { adjustMemberPoints } from '@/infrastructure/supabase/repositories/member-repository'
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { Language } from '@/domain/value-objects/language'
import { mintAndDeliverReward } from '@/application/mint-and-deliver-reward'
import {
  rewardNotFoundMessage,
  rewardInsufficientPointsMessage,
} from './messages/redeem-reward-messages'

export type RedeemRewardResult =
  | { success: true; couponCode: string }
  | { success: false; message: string }

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
  const code = await mintAndDeliverReward({
    reward,
    restaurantId: params.restaurantId,
    memberId: params.memberId,
    phone: params.phone,
    phoneNumberId: params.phoneNumberId,
    language,
    source: 'points',
    newBalance,
  })
  await logRewardEvent(params, reward, code)
  return { success: true, couponCode: code }
}

async function getMemberBalance(memberId: string): Promise<number> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase.from('members').select('points_balance').eq('id', memberId).single()
  if (error || !data) throw new Error(`Member not found: ${memberId}`)
  return data.points_balance
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

// completeStampCardUseCase (§6) — fires when apply_stamp returns completed=true.
// Mints a reward coupon with ZERO points movement (no adjustMemberPoints), off the
// card's SNAPSHOTTED reward_id, delivers the stamp-variant celebration, records a
// reward_redeem metrics event tagged source=stamp_campaign, and opens a fresh
// in_progress card. A failed mint/notify does NOT roll back the committed stamp —
// the caller (applyStampUseCase) treats this as best-effort.
import { getStampCardById, openNextStampCard } from '@/infrastructure/supabase/repositories/stamp-card-repository'
import { getRewardById } from '@/infrastructure/supabase/repositories/reward-repository'
import { mintAndDeliverReward } from '@/application/mint-and-deliver-reward'
import { emitEvent } from '@/application/emit-event'
import { Language } from '@/domain/value-objects/language'

export interface CompleteStampCardParams {
  restaurantId: string
  memberId: string
  campaignId: string
  cardId: string
  phone: string
  phoneNumberId: string
  language: string | null
}

export async function completeStampCardUseCase(
  params: CompleteStampCardParams
): Promise<void> {
  const card = await getStampCardById(params.cardId)
  if (!card) throw new Error(`completeStampCard: card not found ${params.cardId}`)

  const reward = await getRewardById(card.rewardId)
  if (!reward) throw new Error(`completeStampCard: reward not found ${card.rewardId}`)

  const code = await mintAndDeliverReward({
    reward,
    restaurantId: params.restaurantId,
    memberId: params.memberId,
    phone: params.phone,
    phoneNumberId: params.phoneNumberId,
    language: Language.fromCodeOrDefault(params.language, Language.default()),
    source: 'stamp_campaign',
  })

  await logCompletion(params, card.rewardId, reward.name, code)
  await openNextStampCard({
    restaurantId: params.restaurantId,
    memberId: params.memberId,
    campaignId: params.campaignId,
  })
}

async function logCompletion(
  params: CompleteStampCardParams,
  rewardId: string,
  rewardName: string,
  code: string
): Promise<void> {
  await emitEvent({
    restaurantId: params.restaurantId,
    memberId: params.memberId,
    type: 'reward_redeem',
    source: 'stamp_campaign',
    dataJson: {
      reward_id: rewardId,
      reward_name: rewardName,
      coupon_code: code,
      campaign_id: params.campaignId,
      source: 'stamp_campaign',
    },
  })
}

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { sendTextMessage, sendInteractiveButtons } from '@/infrastructure/whatsapp/messaging'
import { redeemCouponUseCase } from '@/application/redeem-coupon'
import { listActiveRewards } from '@/infrastructure/supabase/repositories/reward-repository'
import { redeemRewardUseCase } from '@/application/redeem-reward'
import { findMemberByPhone } from '@/infrastructure/supabase/repositories/member-repository'
import { resolveLanguageForMember } from './resolve-language'
import { getSystemReply } from './system-replies'

export async function handleRedeem(
  phoneNumberId: string,
  phone: string,
  code: string,
  restaurantId: string
) {
  const member = await findMemberByPhone(restaurantId, phone)
  if (!member) {
    const lang = await resolveLanguageForMember(null, restaurantId)
    return sendTextMessage(phoneNumberId, phone, getSystemReply('nonMember', lang))
  }

  const language = await resolveLanguageForMember(member, restaurantId)
  const result = await redeemCouponUseCase(code, member.id, restaurantId, language)
  return sendTextMessage(phoneNumberId, phone, result.message)
}

export async function handleUnsubscribe(
  phoneNumberId: string,
  phone: string,
  restaurantId: string
) {
  const { emitEvent } = await import('@/application/emit-event')
  const member = await findMemberByPhone(restaurantId, phone)
  if (!member) return

  const language = await resolveLanguageForMember(member, restaurantId)
  const supabase = createServerSupabaseClient()
  await supabase.from('members').update({ status: 'unsubscribed' }).eq('id', member.id)

  await emitEvent({
    restaurantId,
    memberId: member.id,
    type: 'unsubscribe',
    dataJson: {},
  })

  return sendTextMessage(phoneNumberId, phone, getSystemReply('unsubscribed', language))
}

export async function handleRewards(
  phoneNumberId: string,
  phone: string,
  restaurantId: string
) {
  const member = await findMemberByPhone(restaurantId, phone)
  if (!member) {
    const lang = await resolveLanguageForMember(null, restaurantId)
    return sendTextMessage(phoneNumberId, phone, getSystemReply('nonMember', lang))
  }

  const language = await resolveLanguageForMember(member, restaurantId)
  const rewards = await listActiveRewards(restaurantId)

  if (rewards.length === 0) {
    return sendTextMessage(phoneNumberId, phone, getSystemReply('rewardsEmpty', language))
  }

  const affordable = rewards.filter((r) => member.pointsBalance >= r.pointsCost)

  if (affordable.length === 0) {
    const cheapest = rewards.reduce((min, r) => r.pointsCost < min.pointsCost ? r : min, rewards[0])
    return sendTextMessage(
      phoneNumberId,
      phone,
      getSystemReply('cantAfford', language, {
        points: member.pointsBalance,
        name: cheapest.name,
        cost: cheapest.pointsCost,
      })
    )
  }

  const buttons = affordable.slice(0, 3).map((r) => ({
    id: `REWARD_${r.id}`,
    title: getSystemReply('rewardButton', language, {
      name: r.name,
      cost: r.pointsCost,
    }).slice(0, 20),
  }))

  return sendInteractiveButtons(
    phoneNumberId,
    phone,
    getSystemReply('rewardsHeader', language, { points: member.pointsBalance }),
    buttons
  )
}

export async function handleRewardRedeem(
  phoneNumberId: string,
  phone: string,
  rewardId: string,
  restaurantId: string
) {
  const member = await findMemberByPhone(restaurantId, phone)
  if (!member) {
    const lang = await resolveLanguageForMember(null, restaurantId)
    return sendTextMessage(phoneNumberId, phone, getSystemReply('nonMember', lang))
  }

  const language = await resolveLanguageForMember(member, restaurantId)

  try {
    const result = await redeemRewardUseCase({
      memberId: member.id,
      rewardId,
      restaurantId,
      phone,
      phoneNumberId,
      language,
    })

    if (!result.success) {
      return sendTextMessage(phoneNumberId, phone, result.message)
    }
  } catch (error) {
    console.error('Reward redeem error:', error)
    // Catch-all error text stays English per ONBOARD-008 scope lock.
    return sendTextMessage(
      phoneNumberId,
      phone,
      'Sorry, something went wrong. Please try again later.'
    )
  }
}

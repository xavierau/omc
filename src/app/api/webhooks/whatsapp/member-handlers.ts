import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { sendTextMessage, sendInteractiveButtons } from '@/infrastructure/kapso/client'
import { redeemCouponUseCase } from '@/application/redeem-coupon'
import { listActiveRewards } from '@/infrastructure/supabase/repositories/reward-repository'
import { redeemRewardUseCase } from '@/application/redeem-reward'

export async function handleRedeem(
  phoneNumberId: string,
  phone: string,
  code: string,
  restaurantId: string
) {
  const member = await findMemberByPhone(phone)
  if (!member) {
    return sendTextMessage(phoneNumberId, phone, "You're not a member yet. Reply JOIN to sign up!")
  }

  const result = await redeemCouponUseCase(code, member.id, restaurantId)
  return sendTextMessage(phoneNumberId, phone, result.message)
}

export async function handleUnsubscribe(
  phoneNumberId: string,
  phone: string,
  restaurantId: string
) {
  const { createEvent } = await import('@/infrastructure/supabase/repositories/event-repository')
  const supabase = createServerSupabaseClient()

  const { data: member } = await supabase
    .from('members')
    .select('id')
    .eq('phone', phone)
    .single()

  if (!member) return

  await supabase.from('members').update({ status: 'unsubscribed' }).eq('id', member.id)

  await createEvent({
    restaurantId,
    memberId: member.id,
    type: 'unsubscribe',
    dataJson: {},
  })

  return sendTextMessage(phoneNumberId, phone, "You've been unsubscribed. Reply JOIN anytime to re-join.")
}

export async function handleRewards(
  phoneNumberId: string,
  phone: string,
  restaurantId: string
) {
  const supabase = createServerSupabaseClient()
  const { data: member } = await supabase
    .from('members')
    .select('id, points_balance')
    .eq('phone', phone)
    .single()

  if (!member) {
    return sendTextMessage(phoneNumberId, phone, "You're not a member yet. Reply JOIN to sign up!")
  }

  const rewards = await listActiveRewards(restaurantId)

  if (rewards.length === 0) {
    return sendTextMessage(phoneNumberId, phone, 'No rewards available yet. Stay tuned!')
  }

  const affordable = rewards.filter((r) => member.points_balance >= r.pointsCost)

  if (affordable.length === 0) {
    const cheapest = rewards.reduce((min, r) => r.pointsCost < min.pointsCost ? r : min, rewards[0])
    return sendTextMessage(
      phoneNumberId,
      phone,
      `You have ${member.points_balance} points. Keep earning to unlock rewards! Next reward: ${cheapest.name} (${cheapest.pointsCost} pts)`
    )
  }

  const buttons = affordable.slice(0, 3).map((r) => ({
    id: `REWARD_${r.id}`,
    title: `${r.name} (${r.pointsCost}pts)`.slice(0, 20),
  }))

  return sendInteractiveButtons(
    phoneNumberId,
    phone,
    `🎁 You have ${member.points_balance} points! Choose a reward:`,
    buttons
  )
}

export async function handleRewardRedeem(
  phoneNumberId: string,
  phone: string,
  rewardId: string,
  restaurantId: string
) {
  const supabase = createServerSupabaseClient()
  const { data: member } = await supabase
    .from('members')
    .select('id')
    .eq('phone', phone)
    .single()

  if (!member) {
    return sendTextMessage(phoneNumberId, phone, "You're not a member yet. Reply JOIN to sign up!")
  }

  try {
    const result = await redeemRewardUseCase({
      memberId: member.id,
      rewardId,
      restaurantId,
      phone,
      phoneNumberId,
    })

    if (!result.success) {
      return sendTextMessage(phoneNumberId, phone, result.message)
    }
  } catch (error) {
    console.error('Reward redeem error:', error)
    return sendTextMessage(phoneNumberId, phone, 'Sorry, something went wrong. Please try again later.')
  }
}

async function findMemberByPhone(phone: string) {
  const supabase = createServerSupabaseClient()
  const { data } = await supabase
    .from('members')
    .select('id')
    .eq('phone', phone)
    .single()
  return data
}

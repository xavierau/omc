import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { sendTextMessage, sendInteractiveButtons } from '@/infrastructure/whatsapp/messaging'
import { getRestaurantPhoneNumberId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { registerMember } from '@/application/register-member'
import { enqueueReceiptProcessing } from '@/infrastructure/gcp/queue-client'
import { findPendingReceipt } from '@/infrastructure/supabase/repositories/receipt-repository'
import { confirmReceipt } from '@/application/process-receipt'
import { maskPhone } from '@/infrastructure/logging/logger'
import { PhoneNumber } from '@/domain/value-objects/phone-number'
import { handleRedeem, handleUnsubscribe, handleRewards, handleRewardRedeem } from './member-handlers'
import type { KapsoMessage } from '@/infrastructure/whatsapp/webhooks'

type LogFn = (level: 'info' | 'warn' | 'error', event: string, data: unknown) => void
const noop: LogFn = () => {}

export async function routeMessage(message: KapsoMessage, restaurantId: string, log: LogFn = noop) {
  const text = message.text?.trim().toUpperCase() ?? ''
  const phone = PhoneNumber.create(message.from).value
  const phoneNumberId = await getRestaurantPhoneNumberId(restaurantId)
  const route = resolveRoute(text, message.type)
  log('info', 'handler.route', { route, phone: maskPhone(phone) })

  if (text === 'JOIN' || text.startsWith('JOIN-')) {
    try {
      return await registerMember(restaurantId, phone, message.contactName)
    } catch (error) {
      log('error', 'handler.error', { route: 'JOIN', error: String(error) })
      return sendTextMessage(phoneNumberId, phone, 'Sorry, something went wrong. Please try again later.')
    }
  }
  if (text === 'POINTS') return handlePoints(phoneNumberId, phone)
  if (text.startsWith('REDEEM ')) {
    return handleRedeem(phoneNumberId, phone, text.replace('REDEEM ', '').trim(), restaurantId)
  }
  if (text === 'REWARD' || text === 'REWARDS') {
    return handleRewards(phoneNumberId, phone, restaurantId)
  }
  if (text.startsWith('REWARD_')) {
    const rewardId = text.replace('REWARD_', '').toLowerCase()
    return handleRewardRedeem(phoneNumberId, phone, rewardId, restaurantId)
  }
  if (text === 'STOP') return handleUnsubscribe(phoneNumberId, phone, restaurantId)
  if (message.type === 'image') {
    return handleReceiptImage(phoneNumberId, phone, restaurantId, message.imageUrl, message.imageId)
  }

  const handled = await handleReceiptConfirmation(phoneNumberId, phone, text, restaurantId)
  if (handled) return

  return handleUnknown(phoneNumberId, phone)
}

async function handlePoints(phoneNumberId: string, phone: string) {
  const supabase = createServerSupabaseClient()
  const { data } = await supabase
    .from('members').select('points_balance, name').eq('phone', phone).single()
  if (!data) {
    return sendTextMessage(phoneNumberId, phone, "You're not a member yet. Reply JOIN to sign up!")
  }
  return sendTextMessage(phoneNumberId, phone, `Your balance: ${data.points_balance} points. Send a receipt photo to earn more!`)
}

async function handleReceiptImage(
  phoneNumberId: string,
  phone: string,
  restaurantId: string,
  imageUrl?: string,
  imageId?: string
) {
  if (!imageUrl && !imageId) {
    return sendTextMessage(phoneNumberId, phone, 'Sorry, I could not retrieve that image. Please try again.')
  }

  const member = await findMemberByPhone(phone)
  if (!member) {
    return sendTextMessage(phoneNumberId, phone, "You're not a member yet. Reply JOIN to sign up!")
  }

  await sendTextMessage(phoneNumberId, phone, 'Got your receipt! Scanning now... this takes about 10 seconds.')
  await enqueueReceiptProcessing({
    restaurantId,
    memberId: member.id,
    phone,
    imageUrl: imageUrl ?? '',
    imageId,
    phoneNumberId,
  })
}

async function handleReceiptConfirmation(
  phoneNumberId: string,
  phone: string,
  text: string,
  restaurantId: string
): Promise<boolean> {
  const isYes = text === 'YES'
  const numericAmount = parseFloat(text)
  const isNumber = !isNaN(numericAmount) && numericAmount > 0

  if (!isYes && !isNumber) return false

  const member = await findMemberByPhone(phone)
  if (!member) return false

  const pending = await findPendingReceipt(member.id)
  if (!pending) return false

  const amount = isYes ? (pending.pending_amount as number) : numericAmount
  await confirmReceipt(member.id, restaurantId, phone, pending.id as string, amount)
  return true
}

async function handleUnknown(phoneNumberId: string, phone: string) {
  const member = await findMemberByPhone(phone)
  if (member) {
    return sendInteractiveButtons(phoneNumberId, phone,
      'How can I help? To redeem a coupon, reply REDEEM <code>. To earn points, send a receipt photo.',
      [{ id: 'POINTS', title: 'Check Points' }, { id: 'REWARDS', title: 'View Rewards' }]
    )
  }
  return sendInteractiveButtons(phoneNumberId, phone,
    'Welcome! Join our rewards program to earn points on every visit, unlock exclusive coupons, and get special member-only offers.',
    [{ id: 'JOIN', title: 'Join Rewards' }]
  )
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

function resolveRoute(text: string, type: string): string {
  if (text === 'JOIN' || text.startsWith('JOIN-')) return 'JOIN'
  if (text === 'POINTS') return 'POINTS'
  if (text.startsWith('REDEEM ')) return 'REDEEM'
  if (text === 'REWARD' || text === 'REWARDS') return 'REWARDS'
  if (text.startsWith('REWARD_')) return 'REWARD_REDEEM'
  if (text === 'STOP') return 'STOP'
  if (type === 'image') return 'receipt-image'
  return 'unknown'
}

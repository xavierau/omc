import { sendTextMessage } from '@/infrastructure/whatsapp/messaging'
import { findMemberByPhone } from '@/infrastructure/supabase/repositories/member-repository'
import { registerMember } from '@/application/register-member'
import { enqueueReceiptProcessing } from '@/infrastructure/gcp/queue-client'
import type { KapsoMessage } from '@/infrastructure/whatsapp/webhooks'
import { resolveLanguageForMember } from './resolve-language'
import { getSystemReply } from './system-replies'

type LogFn = (level: 'info' | 'warn' | 'error', event: string, data: unknown) => void

export interface JoinParams {
  message: KapsoMessage
  restaurantId: string
  phone: string
  phoneNumberId: string
  log: LogFn
}

export async function handleJoin(params: JoinParams) {
  const { message, restaurantId, phone, phoneNumberId, log } = params
  try {
    // Bare `JOIN` and QR-deep-link `JOIN-{restaurantId}` are both ASCII
    // and would always detect as EN, falsely pinning member language to
    // English regardless of their actual preference. Skip detection for
    // JOIN-family ASCII inputs — the restaurant default wins. Chinese
    // aliases (加入/入會/註冊) pass through and are detected as zh_hk.
    const upper = (message.text ?? '').trim().toUpperCase()
    const isAsciiJoin = upper === 'JOIN' || upper.startsWith('JOIN-')
    const inboundForDetection = isAsciiJoin ? undefined : message.text
    return await registerMember(restaurantId, phone, message.contactName, inboundForDetection)
  } catch (error) {
    log('error', 'handler.error', { route: 'JOIN', error: String(error) })
    // Catch-all error text stays English per ONBOARD-008 scope lock.
    return sendTextMessage(phoneNumberId, phone, 'Sorry, something went wrong. Please try again later.')
  }
}

export async function handleReceiptImage(
  phoneNumberId: string,
  phone: string,
  restaurantId: string,
  imageUrl?: string,
  imageId?: string
) {
  const member = await findMemberByPhone(restaurantId, phone)
  const language = await resolveLanguageForMember(member, restaurantId)

  if (!imageUrl && !imageId) {
    return sendTextMessage(phoneNumberId, phone, getSystemReply('receiptImageMissing', language))
  }

  if (!member) {
    return sendTextMessage(phoneNumberId, phone, getSystemReply('nonMember', language))
  }

  await sendTextMessage(phoneNumberId, phone, getSystemReply('receiptAck', language))
  await enqueueReceiptProcessing({
    restaurantId,
    memberId: member.id,
    phone,
    imageUrl: imageUrl ?? '',
    imageId,
    phoneNumberId,
  })
}

export async function handlePoints(
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
  return sendTextMessage(
    phoneNumberId,
    phone,
    getSystemReply('balance', language, { points: member.pointsBalance })
  )
}

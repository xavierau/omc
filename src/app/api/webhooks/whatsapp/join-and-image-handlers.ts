import { sendTextMessage } from '@/infrastructure/whatsapp/messaging'
import { findMemberByPhone } from '@/infrastructure/supabase/repositories/member-repository'
import { registerMember } from '@/application/register-member'
import { enqueueReceiptProcessing } from '@/infrastructure/gcp/queue-client'
import type { KapsoMessage } from '@/infrastructure/whatsapp/webhooks'

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
    // QR deep-link `JOIN-{restaurantId}` is always ASCII and would always
    // detect as EN, persisting the wrong language for zh-menu QR scans.
    // Only pass the inbound text for detection when the user actually
    // typed something — not when the text came from a QR-seeded link.
    const upper = (message.text ?? '').trim().toUpperCase()
    const inboundForDetection = upper.startsWith('JOIN-') ? undefined : message.text
    return await registerMember(restaurantId, phone, message.contactName, inboundForDetection)
  } catch (error) {
    log('error', 'handler.error', { route: 'JOIN', error: String(error) })
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
  if (!imageUrl && !imageId) {
    return sendTextMessage(phoneNumberId, phone, 'Sorry, I could not retrieve that image. Please try again.')
  }

  const member = await findMemberByPhone(restaurantId, phone)
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

export async function handlePoints(
  phoneNumberId: string,
  phone: string,
  restaurantId: string
) {
  const member = await findMemberByPhone(restaurantId, phone)
  if (!member) {
    return sendTextMessage(phoneNumberId, phone, "You're not a member yet. Reply JOIN to sign up!")
  }
  return sendTextMessage(
    phoneNumberId,
    phone,
    `Your balance: ${member.pointsBalance} points. Send a receipt photo to earn more!`
  )
}

import { getMessagingProvider } from './provider-factory'
import type { SendResult } from '@/domain/value-objects/send-result'

export function sendTextMessage(
  phoneNumberId: string,
  to: string,
  text: string
): Promise<SendResult> {
  return getMessagingProvider().sendText(phoneNumberId, to, text)
}

export function sendImageMessage(
  phoneNumberId: string,
  to: string,
  imageUrl: string,
  caption?: string
): Promise<SendResult> {
  return getMessagingProvider().sendImage(
    phoneNumberId, to, imageUrl, caption
  )
}

export function sendInteractiveButtons(
  phoneNumberId: string,
  to: string,
  bodyText: string,
  buttons: Array<{ id: string; title: string }>,
  footerText?: string
): Promise<SendResult> {
  return getMessagingProvider().sendInteractiveButtons(
    phoneNumberId, to, bodyText, buttons, footerText
  )
}

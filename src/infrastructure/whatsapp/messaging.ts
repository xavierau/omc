import { getMessagingProvider } from './provider-factory'

export function sendTextMessage(
  phoneNumberId: string,
  to: string,
  text: string
): Promise<void> {
  return getMessagingProvider().sendText(phoneNumberId, to, text)
}

export function sendImageMessage(
  phoneNumberId: string,
  to: string,
  imageUrl: string,
  caption?: string
): Promise<void> {
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
): Promise<void> {
  return getMessagingProvider().sendInteractiveButtons(
    phoneNumberId, to, bodyText, buttons, footerText
  )
}

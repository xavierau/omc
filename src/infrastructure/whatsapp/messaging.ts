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

export function sendInteractiveList(
  phoneNumberId: string,
  to: string,
  bodyText: string,
  buttonText: string,
  sections: Array<{
    title?: string
    rows: Array<{ id: string; title: string; description?: string }>
  }>,
  footerText?: string
): Promise<SendResult> {
  return getMessagingProvider().sendInteractiveList(
    phoneNumberId, to, bodyText, buttonText, sections, footerText
  )
}

export function sendCtaUrlButton(
  phoneNumberId: string,
  to: string,
  bodyText: string,
  displayText: string,
  url: string,
  footerText?: string
): Promise<SendResult> {
  return getMessagingProvider().sendCtaUrlButton(
    phoneNumberId, to, bodyText, displayText, url, footerText
  )
}

export function sendInteractiveFlow(
  phoneNumberId: string,
  to: string,
  bodyText: string,
  params: {
    flowId: string
    flowCta: string
    flowToken: string
    screen: string
    data: Record<string, unknown>
  },
  footerText?: string
): Promise<SendResult> {
  return getMessagingProvider().sendInteractiveFlow(
    phoneNumberId, to, bodyText, params, footerText
  )
}

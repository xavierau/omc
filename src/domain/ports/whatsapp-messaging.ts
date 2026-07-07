import type { SendResult } from '@/domain/value-objects/send-result'

export interface WhatsAppMessagingPort {
  sendText(
    phoneNumberId: string,
    to: string,
    text: string
  ): Promise<SendResult>
  sendImage(
    phoneNumberId: string,
    to: string,
    imageUrl: string,
    caption?: string
  ): Promise<SendResult>
  sendInteractiveButtons(
    phoneNumberId: string,
    to: string,
    bodyText: string,
    buttons: Array<{ id: string; title: string }>,
    footerText?: string
  ): Promise<SendResult>
  sendInteractiveList(
    phoneNumberId: string,
    to: string,
    bodyText: string,
    buttonText: string,
    sections: Array<{
      title?: string
      rows: Array<{ id: string; title: string; description?: string }>
    }>,
    footerText?: string
  ): Promise<SendResult>
  sendCtaUrlButton(
    phoneNumberId: string,
    to: string,
    bodyText: string,
    displayText: string,
    url: string,
    footerText?: string
  ): Promise<SendResult>
}

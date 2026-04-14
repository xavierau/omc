export interface WhatsAppMessagingPort {
  sendText(phoneNumberId: string, to: string, text: string): Promise<void>
  sendImage(
    phoneNumberId: string,
    to: string,
    imageUrl: string,
    caption?: string
  ): Promise<void>
  sendInteractiveButtons(
    phoneNumberId: string,
    to: string,
    bodyText: string,
    buttons: Array<{ id: string; title: string }>,
    footerText?: string
  ): Promise<void>
}

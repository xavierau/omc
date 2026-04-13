export interface InboundMessage {
  messageId: string
  from: string
  type: 'text' | 'image' | 'interactive' | 'unknown'
  text?: string
  imageUrl?: string
  imageId?: string
  timestamp: string
  contactName?: string
}

export type LogFn = (level: 'info' | 'warn' | 'error', event: string, data: unknown) => void

export interface WhatsAppWebhookPort {
  parse(
    body: unknown,
    headers?: Record<string, string | undefined>,
    log?: LogFn
  ): InboundMessage | null
  verifySignature(
    body: string,
    signature: string,
    secret: string
  ): boolean
}

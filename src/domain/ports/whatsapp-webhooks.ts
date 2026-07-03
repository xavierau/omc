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

// 'critical' was added in WAQ-003 for policy-violation alerts (132xxx codes
// classified by `classifyErrorCode` in src/domain/value-objects/whatsapp-error-code.ts).
// Existing infrastructure log adapters that only handle info/warn/error treat
// 'critical' as an error-level entry; the level is still surfaced in
// structured payloads so log aggregators can route differently.
export type LogFn = (
  level: 'info' | 'warn' | 'error' | 'critical',
  event: string,
  data: unknown
) => void

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

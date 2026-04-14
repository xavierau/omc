import { getWebhookProvider } from './provider-factory'
import type { InboundMessage, LogFn } from '@/domain/ports/whatsapp-webhooks'

export type { InboundMessage, LogFn }
export type KapsoMessage = InboundMessage

export function parseKapsoWebhook(
  body: unknown,
  headers?: Record<string, string | undefined>,
  log?: LogFn
): InboundMessage | null {
  return getWebhookProvider().parse(body, headers, log)
}

export function verifyKapsoSignature(
  body: string,
  signature: string,
  secret: string
): boolean {
  return getWebhookProvider().verifySignature(
    body, signature, secret
  )
}

import {
  parseKapsoWebhook,
  verifyKapsoSignature,
} from '@/infrastructure/kapso/webhook-parser'
import type { WhatsAppWebhookPort } from '@/domain/ports/whatsapp-webhooks'

export const kapsoWebhookAdapter: WhatsAppWebhookPort = {
  parse: (body, headers, log) => parseKapsoWebhook(body, headers, log),
  verifySignature: verifyKapsoSignature,
}

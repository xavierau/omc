// INT-001 WI-6: module-level singleton factory for `UndiciOutboundSender`,
// matching the repo's existing pattern (`getEmailProvider()`). Keeps
// `deliver-outbound-webhook.ts` (application layer) from constructing an
// infrastructure class directly.

import { UndiciOutboundSender } from './outbound-webhook-sender'
import type { OutboundWebhookSender } from '@/domain/ports/outbound-webhook-sender'

let senderInstance: OutboundWebhookSender | null = null

export function getOutboundWebhookSender(): OutboundWebhookSender {
  if (!senderInstance) senderInstance = new UndiciOutboundSender()
  return senderInstance
}

export function _resetOutboundWebhookSenderForTests(): void {
  senderInstance = null
}

// SendResult-shaped result for one outbound webhook delivery attempt. See
// src/domain/value-objects/send-result.ts for the sibling WhatsApp-send
// shape this mirrors.
export interface DeliveryResult {
  ok: boolean
  status: number | null
  latencyMs: number
  responseExcerpt: string | null
  error?: { title: string; details?: string }
}

export interface OutboundWebhookRequest {
  url: string
  body: string
  headers: Record<string, string>
  /** Set only by the real adapter's DNS-pin step (WI-5); a fake never needs it. */
  pinnedIp?: string
}

/**
 * The only code path allowed to make an HTTP request to a partner-owned
 * destination URL (T-C3). The real adapter (`UndiciOutboundSender`, WI-5)
 * resolves-and-pins the DNS name before dispatch and never follows
 * redirects.
 */
export interface OutboundWebhookSender {
  send(request: OutboundWebhookRequest): Promise<DeliveryResult>
}

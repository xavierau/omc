// SendResult-shaped result for one outbound webhook delivery attempt. See
// src/domain/value-objects/send-result.ts for the sibling WhatsApp-send
// shape this mirrors.
export interface DeliveryResult {
  ok: boolean
  status: number | null
  latencyMs: number
  responseExcerpt: string | null
  error?: { title: string; details?: string }
  /**
   * WI-6: the response's `Retry-After` header in seconds, when present and
   * a plain integer (an HTTP-date `Retry-After` value is not parsed --
   * `deliver-outbound-webhook.ts` falls back to ordinary exponential
   * backoff rather than honouring it). Only meaningful on a 429; other
   * statuses may carry it too, in which case it's simply unused. Additive
   * field -- WI-1's original `DeliveryResult` had no header access at all,
   * which made the plan's own "429 honours Retry-After via moveToDelayed"
   * requirement unimplementable without it.
   */
  retryAfterSec?: number
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

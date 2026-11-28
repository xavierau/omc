/**
 * BOOK-014 (threat R47, R48, R50): one delivery to a provider's payment
 * webhook. The route has already refused a missing secret (R47) and an
 * oversize body (R48) before this runs.
 *
 * 1. The adapter verifies the signature on the RAW body before anything is
 *    parsed or written (R48): a bad or missing signature -> 400, nothing written.
 * 2. Each event in the other mode (test vs live) is ignored and logged (R50).
 * 3. Idempotency: `<provider>:<event id>` is claimed in processed_webhooks
 *    after verification; a duplicate is a 200 with no change. If handling
 *    throws, the claim is released and the answer is 500, so the provider
 *    retries and the retry can succeed.
 * 4. W6-fix F4: an event the handler cannot decide yet (`retry_later`) also
 *    releases its claim, answered 503, so the provider redelivers it.
 */
import type { PaymentLog, WebhookClaimStore } from '@/domain/ports/booking-deposit'
import { WebhookSignatureError, type NormalizedPaymentEvent, type PaymentGatewayPort } from '@/domain/ports/payment-gateway'
import { handlePaymentEvent, type HandlePaymentEventDeps, type PaymentEventOutcome } from './handle-payment-event'

export interface ProcessPaymentWebhookDeps extends HandlePaymentEventDeps {
  gateway: PaymentGatewayPort
  claims: WebhookClaimStore
}

export interface PaymentWebhookResponse {
  status: 200 | 400 | 500 | 503
  body: { received: true; outcomes: Array<PaymentEventOutcome | 'duplicate' | 'mode_mismatch'> } | { error: string }
}

export function paymentIdempotencyKey(gateway: PaymentGatewayPort, eventId: string): string {
  return `${gateway.code}:${eventId}`
}

async function releaseQuietly(claims: WebhookClaimStore, key: string, log: PaymentLog) {
  try {
    await claims.release(key)
  } catch (err) {
    log('error', 'payment.claim_release_failed', { key, error: (err as Error).message })
  }
}

export async function processPaymentWebhook(
  deps: ProcessPaymentWebhookDeps,
  request: { rawBody: string; headers: { get(name: string): string | null } }
): Promise<PaymentWebhookResponse> {
  const { gateway, claims, log } = deps
  let events: NormalizedPaymentEvent[]
  try {
    events = gateway.parseWebhook({ rawBody: request.rawBody, headers: request.headers })
  } catch (err) {
    const invalid = err instanceof WebhookSignatureError
    log('warn', 'payment.webhook_rejected', { provider: gateway.code, reason: invalid ? 'signature' : 'parse', error: (err as Error).name })
    return { status: 400, body: { error: invalid ? 'invalid_signature' : 'invalid_payload' } }
  }

  const outcomes: Array<PaymentEventOutcome | 'duplicate' | 'mode_mismatch'> = []
  for (const event of events) {
    if (event.livemode !== gateway.livemode) {
      log('warn', 'payment.security_mismatch', { reason: 'mode_mismatch', eventId: event.eventId, livemode: event.livemode })
      outcomes.push('mode_mismatch')
      continue
    }
    const key = paymentIdempotencyKey(gateway, event.eventId)
    const claim = await claims.claim(key)
    if (claim === 'duplicate') {
      outcomes.push('duplicate')
      continue
    }
    if (claim === 'error') return { status: 500, body: { error: 'idempotency_unavailable' } }
    try {
      const outcome = await handlePaymentEvent(deps, gateway.code, event)
      if (outcome === 'retry_later') {
        await releaseQuietly(claims, key, log)
        return { status: 503, body: { error: 'retry_later' } }
      }
      outcomes.push(outcome)
    } catch (err) {
      log('error', 'payment.event_failed', { key, type: event.type, error: (err as Error).message })
      await releaseQuietly(claims, key, log)
      return { status: 500, body: { error: 'processing_failed' } }
    }
  }
  return { status: 200, body: { received: true, outcomes } }
}

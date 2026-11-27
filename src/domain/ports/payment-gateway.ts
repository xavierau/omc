/**
 * BOOK-014 (spec S8, AC-15; threat R51): the ONLY contract booking code has
 * with a payment provider. Adapters live in `src/infrastructure/payments/<code>/`;
 * no provider type, id format or SDK import crosses this file. A new region
 * adds an adapter (plus its webhook route and onboarding screen), nothing else.
 *
 * Adapters never throw raw provider errors: a failed call is a
 * PaymentGatewayError with a fixed code; its message is for the server log
 * only and never reaches a diner or an agent (R64).
 */
import type { Money } from '@/domain/value-objects/money'

/** Registry key, stored on `merchant_payment_accounts.provider_code` and `booking_deposits.provider_code`. */
export type PaymentProviderCode = 'stripe' | 'test'

export interface HostedPaymentRequest {
  /** The restaurant's account at the provider (stored on the deposit at creation). */
  accountRef: string
  amount: Money
  /** One line the diner sees on the hosted page; no PII (R61). */
  description: string
  successUrl: string
  cancelUrl: string
  /** The hold's end. A provider may extend it to its own minimum; a payment after the hold is a late payment. */
  expiresAt: Date
  /** The deposit id: a retry never makes a second session. */
  idempotencyKey: string
  /** Exactly these two ids (R61). Never used to find a deposit (R49). */
  metadata: { deposit_id: string; booking_id: string }
}

export interface HostedPayment {
  sessionRef: string
  url: string
  expiresAt: Date
}

export interface RefundRequest {
  accountRef: string
  paymentRef: string
  amount: Money
  /** refund:<deposit id>:<attempt> (R56). */
  idempotencyKey: string
}

export type RefundResult =
  | { refundRef: string; status: 'succeeded' | 'pending' | 'failed' }
  /**
   * The provider says the payment is already fully refunded (review finding 1c): the money is back,
   * e.g. a re-drive after the original idempotency key expired (Stripe: 24 h). No new refund was made.
   */
  | { refundRef: null; status: 'already_refunded' }

export interface ProviderAccountStatus {
  chargesEnabled: boolean
  detailsSubmitted: boolean
  currency: string | null
  disabledReason: string | null
}

interface EventBase {
  /** The provider's event id: the idempotency key is `<provider code>:<eventId>` (R48). */
  eventId: string
  livemode: boolean
  /** The connected account the event came from (R49: must equal the deposit's). */
  accountRef: string | null
}

/** R51: every provider event an adapter understands, normalised. Unknown types never become one. */
export type NormalizedPaymentEvent =
  | (EventBase & {
      type: 'payment_succeeded'
      sessionRef: string
      paymentRef: string | null
      amount: Money | null
      /** The provider says the money is captured (Stripe: payment_status 'paid'). */
      paid: boolean
    })
  | (EventBase & { type: 'payment_expired'; sessionRef: string })
  | (EventBase & { type: 'refund_succeeded'; paymentRef: string; refundRef: string | null })
  | (EventBase & { type: 'refund_failed'; paymentRef: string; refundRef: string | null })
  | (EventBase & { type: 'account_updated'; status: ProviderAccountStatus })
  | (EventBase & { type: 'account_deauthorized' })

export type NormalizedPaymentEventType = NormalizedPaymentEvent['type']

export interface WebhookRequest {
  rawBody: string
  headers: { get(name: string): string | null }
}

export type PaymentGatewayErrorCode =
  /** Network, provider outage, rate limit: try again later. */
  | 'unavailable'
  /** The provider refused the request (invalid, account restricted, permission). */
  | 'rejected'
  /** The object no longer exists at the provider. */
  | 'not_found'

export class PaymentGatewayError extends Error {
  constructor(readonly code: PaymentGatewayErrorCode, message: string) {
    super(message)
    this.name = 'PaymentGatewayError'
  }
}

/** The webhook signature is missing, malformed, stale or wrong (R47, R48). */
export class WebhookSignatureError extends Error {
  constructor(message = 'invalid webhook signature') {
    super(message)
    this.name = 'WebhookSignatureError'
  }
}

export interface PaymentGatewayPort {
  readonly code: PaymentProviderCode
  /** The mode this adapter was built for; an event in the other mode is ignored (R50). */
  readonly livemode: boolean
  /** Hosts a hosted-payment URL may point at; /p/<token> redirects only there (R62). */
  readonly allowedRedirectHosts: readonly string[]

  createAccount(input: { restaurantId: string }): Promise<{ accountRef: string }>
  createOnboardingLink(input: { accountRef: string; returnUrl: string; refreshUrl: string }): Promise<{ url: string }>
  getAccountStatus(accountRef: string): Promise<ProviderAccountStatus>

  createHostedPayment(request: HostedPaymentRequest): Promise<HostedPayment>
  /** Closes an open session. `expired: false` = it was already completed or closed (not an error, R57). */
  expireHostedPayment(input: { accountRef: string; sessionRef: string }): Promise<{ expired: boolean }>
  refund(request: RefundRequest): Promise<RefundResult>

  /** Verifies the signature on the raw body first (throws WebhookSignatureError), then normalises. */
  parseWebhook(request: WebhookRequest): NormalizedPaymentEvent[]
}

/** R51 / AC-15: the provider is chosen per restaurant by its account's provider code. */
export interface PaymentGatewayRegistry {
  get(code: PaymentProviderCode): PaymentGatewayPort
}

export function isPaymentProviderCode(value: unknown): value is PaymentProviderCode {
  return value === 'stripe' || value === 'test'
}

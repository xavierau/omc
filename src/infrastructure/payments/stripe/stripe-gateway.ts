/**
 * BOOK-014: the Stripe adapter of PaymentGatewayPort. Stripe Connect
 * STANDARD, DIRECT charges on the restaurant's connected account (every call
 * carries `Stripe-Account` with the platform key), hosted Checkout in payment
 * mode, no application fee (owner 2026-11-27, spec decision 1). No card data
 * ever reaches us (PCI SAQ-A).
 *
 * Nothing Stripe-shaped leaves this folder (AC-15, R51): calls return port
 * types, failures become PaymentGatewayError with a fixed code and a message
 * of Stripe's error type/code only (R64), never the SDK error object.
 */
import Stripe from 'stripe'
import {
  PaymentGatewayError,
  WebhookSignatureError,
  type HostedPayment,
  type HostedPaymentRequest,
  type NormalizedPaymentEvent,
  type PaymentGatewayErrorCode,
  type PaymentGatewayPort,
  type ProviderAccountStatus,
  type RefundRequest,
  type RefundResult,
  type WebhookRequest,
} from '@/domain/ports/payment-gateway'
import { parseStripeSettings, type StripeSettings } from './stripe-config'
import { normalizeStripeEvent, stripeAccountStatus } from './stripe-events'

/** Hosted Checkout lives on this host only (R62). */
export const STRIPE_CHECKOUT_HOSTS = ['checkout.stripe.com'] as const

/** Stripe Checkout: expires_at must be 30 minutes to 24 hours after creation; a margin either side. */
const SESSION_MIN_MS = 30 * 60_000 + 60_000
const SESSION_MAX_MS = 24 * 60 * 60_000 - 60_000

export interface StripeGatewayOptions extends StripeSettings {
  /** Tests pass a stubbed HTTP client; production uses the SDK's Node client. */
  httpClient?: Stripe.HttpClient
  now?: () => Date
}

function codeFor(err: unknown): PaymentGatewayErrorCode {
  if (err instanceof Stripe.errors.StripeConnectionError || err instanceof Stripe.errors.StripeAPIError || err instanceof Stripe.errors.StripeRateLimitError) {
    return 'unavailable'
  }
  if (err instanceof Stripe.errors.StripeError && (err.statusCode === 404 || err.code === 'resource_missing')) return 'not_found'
  if (err instanceof Stripe.errors.StripeError) return 'rejected'
  return 'unavailable'
}

/** R64: only Stripe's error type and code travel, never its free text (it can name accounts). */
function gatewayError(op: string, err: unknown): PaymentGatewayError {
  const type = err instanceof Stripe.errors.StripeError ? err.type : (err as Error)?.name ?? 'Error'
  const code = err instanceof Stripe.errors.StripeError ? (err.code ?? '') : ''
  return new PaymentGatewayError(codeFor(err), `stripe ${op} ${type}${code ? ` ${code}` : ''}`)
}

async function call<T>(op: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    throw gatewayError(op, err)
  }
}

/** Unix seconds, rounded UP so the session never closes before the hold it serves (review finding 5). */
export function sessionExpiry(requested: Date, now: Date): number {
  const ms = Math.min(Math.max(requested.getTime(), now.getTime() + SESSION_MIN_MS), now.getTime() + SESSION_MAX_MS)
  return Math.ceil(ms / 1000)
}

export function createStripeGateway(options: StripeGatewayOptions): PaymentGatewayPort {
  const settings = parseStripeSettings({
    STRIPE_SECRET_KEY: options.secretKey,
    STRIPE_WEBHOOK_SECRET: options.webhookSecret,
    STRIPE_MODE: options.mode,
  })
  const stripe = new Stripe(settings.secretKey, {
    maxNetworkRetries: 1,
    timeout: 10_000,
    telemetry: false,
    ...(options.httpClient ? { httpClient: options.httpClient } : {}),
  })
  const now = options.now ?? (() => new Date())

  return {
    code: 'stripe',
    livemode: settings.mode === 'live',
    allowedRedirectHosts: STRIPE_CHECKOUT_HOSTS,

    async createAccount({ restaurantId }) {
      const account = await call('accounts.create', () =>
        stripe.accounts.create({ type: 'standard', metadata: { restaurant_id: restaurantId } })
      )
      return { accountRef: account.id }
    },

    async createOnboardingLink({ accountRef, returnUrl, refreshUrl }) {
      const link = await call('accountLinks.create', () =>
        stripe.accountLinks.create({ account: accountRef, return_url: returnUrl, refresh_url: refreshUrl, type: 'account_onboarding' })
      )
      return { url: link.url }
    },

    async getAccountStatus(accountRef): Promise<ProviderAccountStatus> {
      return stripeAccountStatus(await call('accounts.retrieve', () => stripe.accounts.retrieve(accountRef)))
    },

    async createHostedPayment(request: HostedPaymentRequest): Promise<HostedPayment> {
      const session = await call('checkout.sessions.create', () =>
        stripe.checkout.sessions.create(
          {
            mode: 'payment',
            // Card only (wallets ride on it): settles synchronously, so a completed session is paid or not, never later.
            allowed_payment_method_types: ['card'],
            line_items: [
              {
                quantity: 1,
                price_data: {
                  currency: request.amount.currency.toLowerCase(),
                  unit_amount: request.amount.amountMinor,
                  product_data: { name: request.description },
                },
              },
            ],
            success_url: request.successUrl,
            cancel_url: request.cancelUrl,
            expires_at: sessionExpiry(request.expiresAt, now()),
            // R61: exactly the two ids; no customer email, phone or name.
            metadata: { deposit_id: request.metadata.deposit_id, booking_id: request.metadata.booking_id },
          },
          { stripeAccount: request.accountRef, idempotencyKey: request.idempotencyKey }
        )
      )
      if (!session.url) throw new PaymentGatewayError('rejected', 'stripe checkout.sessions.create no url')
      return { sessionRef: session.id, url: session.url, expiresAt: new Date(session.expires_at * 1000) }
    },

    async expireHostedPayment({ accountRef, sessionRef }) {
      try {
        await stripe.checkout.sessions.expire(sessionRef, {}, { stripeAccount: accountRef })
        return { expired: true }
      } catch (err) {
        // Completed or already expired: not an error (R57); a late payment is the webhook's to refund.
        if (err instanceof Stripe.errors.StripeInvalidRequestError && err.statusCode !== 404) return { expired: false }
        throw gatewayError('checkout.sessions.expire', err)
      }
    },

    async refund(request: RefundRequest): Promise<RefundResult> {
      let refund: Stripe.Refund
      try {
        refund = await stripe.refunds.create(
          { payment_intent: request.paymentRef, amount: request.amount.amountMinor },
          { stripeAccount: request.accountRef, idempotencyKey: request.idempotencyKey }
        )
      } catch (err) {
        // Review finding 1c: the charge is fully refunded already (e.g. a re-drive after the 24 h key expired).
        if (err instanceof Stripe.errors.StripeInvalidRequestError && err.code === 'charge_already_refunded') {
          return { refundRef: null, status: 'already_refunded' }
        }
        throw gatewayError('refunds.create', err)
      }
      const status = refund.status === 'succeeded' ? 'succeeded' : refund.status === 'failed' || refund.status === 'canceled' ? 'failed' : 'pending'
      return { refundRef: refund.id, status }
    },

    parseWebhook({ rawBody, headers }: WebhookRequest): NormalizedPaymentEvent[] {
      const signature = headers.get('stripe-signature')
      if (!signature) throw new WebhookSignatureError('missing stripe-signature')
      let event: Stripe.Event
      try {
        event = stripe.webhooks.constructEvent(rawBody, signature, settings.webhookSecret)
      } catch {
        throw new WebhookSignatureError()
      }
      return normalizeStripeEvent(event)
    },
  }
}

/** The production adapter: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_MODE from the environment (throws if unusable). */
export function stripeGatewayFromEnv(env: Record<string, string | undefined> = process.env): PaymentGatewayPort {
  return createStripeGateway(parseStripeSettings(env))
}

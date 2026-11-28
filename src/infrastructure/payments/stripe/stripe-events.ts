/**
 * BOOK-014 (threat R51): Stripe events -> NormalizedPaymentEvent. The Connect
 * endpoint subscribes to exactly these (plan Integration Map):
 *   checkout.session.completed        -> payment_succeeded
 *   checkout.session.expired          -> payment_expired
 *   charge.refunded                   -> payment_refunded (W6-fix F1/F7: Stripe sends it when a
 *                                        refund is CREATED, pending or not, and names no refund;
 *                                        it never settles one of our refunds)
 *   refund.updated (succeeded/failed/canceled) -> refund_succeeded | refund_failed (by refund id)
 *   account.updated                   -> account_updated
 *   account.application.deauthorized  -> account_deauthorized
 * Any other type, or one of these in a state that settles nothing, maps to
 * nothing (the route answers 200, R51). Stripe lowercases currencies; ours
 * are upper case. `occurredAt` is the event's `created` (W6-fix F6).
 */
import type Stripe from 'stripe'
import type { NormalizedPaymentEvent, ProviderAccountStatus } from '@/domain/ports/payment-gateway'
import { isCurrencyCode, money, type Money } from '@/domain/value-objects/money'

const idOf = (ref: string | { id: string } | null | undefined): string | null =>
  typeof ref === 'string' ? ref : (ref?.id ?? null)

function amountOf(amountMinor: number | null | undefined, currency: string | null | undefined): Money | null {
  const code = currency?.toUpperCase()
  if (typeof amountMinor !== 'number' || !Number.isSafeInteger(amountMinor) || !isCurrencyCode(code)) return null
  return money(amountMinor, code)
}

export function stripeAccountStatus(account: Stripe.Account): ProviderAccountStatus {
  const currency = account.default_currency?.toUpperCase() ?? null
  return {
    chargesEnabled: account.charges_enabled === true,
    detailsSubmitted: account.details_submitted === true,
    currency: isCurrencyCode(currency) ? currency : null,
    disabledReason: account.requirements?.disabled_reason ?? null,
  }
}

export function normalizeStripeEvent(event: Stripe.Event): NormalizedPaymentEvent[] {
  const base = {
    eventId: event.id,
    livemode: event.livemode,
    accountRef: event.account ?? null,
    occurredAt: new Date(event.created * 1000).toISOString(),
  }
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object
      return [
        {
          ...base,
          type: 'payment_succeeded',
          sessionRef: session.id,
          paymentRef: idOf(session.payment_intent),
          amount: amountOf(session.amount_total, session.currency),
          paid: session.payment_status === 'paid',
        },
      ]
    }
    case 'checkout.session.expired':
      return [{ ...base, type: 'payment_expired', sessionRef: event.data.object.id }]
    case 'charge.refunded': {
      const charge = event.data.object
      const paymentRef = idOf(charge.payment_intent)
      if (!paymentRef) return []
      return [{ ...base, type: 'payment_refunded', paymentRef, fullyRefunded: charge.refunded === true }]
    }
    case 'refund.updated': {
      const refund = event.data.object
      const paymentRef = idOf(refund.payment_intent)
      if (!paymentRef) return []
      if (refund.status === 'succeeded') return [{ ...base, type: 'refund_succeeded', paymentRef, refundRef: refund.id }]
      if (refund.status === 'failed' || refund.status === 'canceled') return [{ ...base, type: 'refund_failed', paymentRef, refundRef: refund.id }]
      return []
    }
    case 'account.updated': {
      const account = event.data.object
      return [{ ...base, accountRef: event.account ?? account.id, type: 'account_updated', status: stripeAccountStatus(account) }]
    }
    case 'account.application.deauthorized':
      return [{ ...base, type: 'account_deauthorized' }]
    default:
      return []
  }
}

/**
 * BOOK-014 (threat R62): what GET /p/<token> does. The token is looked up by
 * its hash only. An open hold redirects (303) to the stored hosted-payment
 * URL, and only when that URL is https on a host the deposit's provider
 * allows; everything else is a neutral page that shows no booking details.
 *
 * `returned` is the provider sending the diner back (?return=success|cancel,
 * our own URLs): after success the webhook may not have landed yet, so the
 * page says the payment is being confirmed instead of redirecting again.
 *
 * W3 (spec AC-5..AC-7, R62): with a `details` reader, the paid / confirming /
 * not-finished pages also show the restaurant, date, time, party and amount
 * (never the diner's name, phone or notes). Lapsed, unknown and unavailable
 * links stay neutral. A details read failure leaves the page neutral.
 */
import type { BookingDeposit } from '@/domain/entities/booking-deposit'
import type { BookingDepositStore, PaymentLog } from '@/domain/ports/booking-deposit'
import type { Money } from '@/domain/value-objects/money'
import type { PaymentGatewayRegistry } from '@/domain/ports/payment-gateway'
import { hashPaymentLinkToken, isPaymentLinkTokenShape } from '@/domain/services/payment-link-token'

/** What the booking's own row adds to a live link's page; no name, phone or notes (R62). */
export interface PaymentLinkBooking {
  restaurantName: string
  bookingDate: string
  bookingTime: string
  partySize: number
}

export interface PaymentLinkDetailsReader {
  /** Scoped by the deposit's own restaurant and booking ids. */
  find(ref: Pick<BookingDeposit, 'restaurantId' | 'bookingId'>): Promise<PaymentLinkBooking | null>
}

export type PaymentLinkDetails = PaymentLinkBooking & { amount: Money }

export interface ResolvePaymentLinkDeps {
  deposits: Pick<BookingDepositStore, 'findByLinkTokenHash'>
  registry: PaymentGatewayRegistry
  now: () => Date
  log: PaymentLog
  /** W3: the booking details on the live-link pages; absent = neutral pages (W1). */
  details?: PaymentLinkDetailsReader
}

export type PaymentLinkState =
  | { kind: 'redirect'; url: string }
  | { kind: 'not_found' }
  | { kind: 'lapsed' }
  | { kind: 'paid'; details?: PaymentLinkDetails }
  | { kind: 'processing'; details?: PaymentLinkDetails }
  /** Back from the hosted page without paying, hold still open: "you have until HH:MM" + Pay now. */
  | { kind: 'unfinished'; holdExpiresAt: string; details?: PaymentLinkDetails }
  | { kind: 'unavailable' }

export function isAllowedRedirect(url: string, hosts: readonly string[]): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && parsed.username === '' && parsed.password === '' && hosts.includes(parsed.hostname)
  } catch {
    return false
  }
}

/** Best effort: a failure is logged with the deposit id only and the page stays neutral (R64). */
async function detailsOf(deps: ResolvePaymentLinkDeps, deposit: BookingDeposit): Promise<{ details?: PaymentLinkDetails }> {
  if (!deps.details) return {}
  try {
    const booking = await deps.details.find({ restaurantId: deposit.restaurantId, bookingId: deposit.bookingId })
    return booking ? { details: { ...booking, amount: deposit.amount } } : {}
  } catch (err) {
    deps.log('error', 'payment_link.details_failed', { depositId: deposit.id, error: (err as Error).name })
    return {}
  }
}

export async function resolvePaymentLink(
  deps: ResolvePaymentLinkDeps,
  input: { token: string; returned: 'success' | 'cancel' | null }
): Promise<PaymentLinkState> {
  if (!isPaymentLinkTokenShape(input.token)) return { kind: 'not_found' }
  const deposit = await deps.deposits.findByLinkTokenHash(hashPaymentLinkToken(input.token))
  if (!deposit) return { kind: 'not_found' }

  if (deposit.status === 'lapsed' || (deposit.status !== 'awaiting' && deposit.refundReason === 'late_payment')) return { kind: 'lapsed' }
  if (deposit.status !== 'awaiting') return { kind: 'paid', ...(await detailsOf(deps, deposit)) }
  if (Date.parse(deposit.holdExpiresAt) <= deps.now().getTime()) return { kind: 'lapsed' }
  if (input.returned === 'success') return { kind: 'processing', ...(await detailsOf(deps, deposit)) }
  if (input.returned === 'cancel') return { kind: 'unfinished', holdExpiresAt: deposit.holdExpiresAt, ...(await detailsOf(deps, deposit)) }

  let hosts: readonly string[] = []
  try {
    hosts = deps.registry.get(deposit.providerCode).allowedRedirectHosts
  } catch (err) {
    deps.log('error', 'payment_link.gateway_unavailable', { depositId: deposit.id, error: (err as Error).name })
    return { kind: 'unavailable' }
  }
  if (!deposit.sessionUrl || !isAllowedRedirect(deposit.sessionUrl, hosts)) {
    deps.log('warn', 'payment.security_mismatch', { reason: 'redirect_host', depositId: deposit.id })
    return { kind: 'unavailable' }
  }
  return { kind: 'redirect', url: deposit.sessionUrl }
}

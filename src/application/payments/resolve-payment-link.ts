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
 *
 * W3 r2: a deposit that is being or has been refunded (declined or staff
 * Refund) is `refunded`, and a kept one is `closed`: neither tells the diner
 * the request was sent. A late-payment refund still reads as lapsed.
 *
 * W6a: a paid deposit whose booking was cancelled or marked no-show is
 * `held` (staff still decide Refund / Keep, AC-13): neutral "your deposit is
 * held; the restaurant will decide on it", never "request sent". It needs the
 * booking status from the details read; without it the page reads paid.
 *
 * W6-fix:
 * - F3: an awaiting deposit past its hold is NOT lapsed yet (the lapse cron
 *   runs every 5 minutes, and a payment the provider accepts meanwhile is
 *   paid). It reads `checking` ("Checking your payment…", neutral, no
 *   refund promise), whatever `returned` says; `lapsed` only once it IS.
 * - G2: paid + booking declined (the decline refund has not started) reads
 *   `refund_due` ("Your deposit will be refunded").
 * - G3: a paid deposit whose details read fails (or finds no booking) reads
 *   `unreadable` ("We couldn't load this payment"), never "Deposit paid".
 */
import { KEEPABLE_BOOKING_STATUSES, type BookingDeposit, type DepositStatus } from '@/domain/entities/booking-deposit'
import type { BookingDepositStore, PaymentLog } from '@/domain/ports/booking-deposit'
import type { BookingSettingsReader } from '@/domain/ports/booking'
import type { PaymentLinkBookingSlot, PaymentLinkDetailsReader } from '@/domain/ports/payment-link-details'
import type { Money } from '@/domain/value-objects/money'
import type { PaymentGatewayRegistry } from '@/domain/ports/payment-gateway'
import { hashPaymentLinkToken, isPaymentLinkTokenShape } from '@/domain/services/payment-link-token'

/** What a live link's page shows: the restaurant, the slot and the amount; no name, phone or notes (R62). */
export type PaymentLinkDetails = PaymentLinkBookingSlot & { restaurantName: string; amount: Money }

export interface ResolvePaymentLinkDeps {
  deposits: Pick<BookingDepositStore, 'findByLinkTokenHash'>
  registry: PaymentGatewayRegistry
  now: () => Date
  log: PaymentLog
  /** W3: the booking slot on the live-link pages; absent = neutral pages (W1). */
  details?: PaymentLinkDetailsReader
  /** W3: the restaurant name for those pages; absent = shown without it. */
  restaurants?: Pick<BookingSettingsReader, 'getRestaurant'>
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
  /** r2: declined or staff Refund; refund_failed reads the same (staff see the failure, W4). */
  | { kind: 'refunded'; details?: PaymentLinkDetails }
  /** r2: the restaurant kept the deposit; neutral. */
  | { kind: 'closed' }
  /** W6a: paid, booking cancelled or no-show, the staff decision still open. */
  | { kind: 'held'; details?: PaymentLinkDetails }
  /** W6-fix F3: awaiting, hold over, not lapsed yet: the payment may still land. Neutral. */
  | { kind: 'checking' }
  /** W6-fix G2: paid, booking declined, the refund not started yet. */
  | { kind: 'refund_due'; details?: PaymentLinkDetails }
  /** W6-fix G3: paid, but the booking could not be read, so its state is unknown. Neutral. */
  | { kind: 'unreadable' }

const REFUNDING: readonly DepositStatus[] = ['refund_pending', 'refunded', 'refund_failed']

export function isAllowedRedirect(url: string, hosts: readonly string[]): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && parsed.username === '' && parsed.password === '' && hosts.includes(parsed.hostname)
  } catch {
    return false
  }
}

type DetailsRead = { kind: 'none' } | { kind: 'failed' } | { kind: 'found'; details: PaymentLinkDetails }

/** A failure is logged with the deposit id only (R64); `none` = no details reader is wired (W1). */
async function readDetails(deps: ResolvePaymentLinkDeps, deposit: BookingDeposit): Promise<DetailsRead> {
  if (!deps.details) return { kind: 'none' }
  try {
    const ref = { restaurantId: deposit.restaurantId, bookingId: deposit.bookingId }
    const [slot, restaurant] = await Promise.all([deps.details.findForDeposit(ref), deps.restaurants?.getRestaurant(deposit.restaurantId) ?? null])
    if (!slot) {
      deps.log('warn', 'payment_link.details_missing', { depositId: deposit.id })
      return { kind: 'failed' }
    }
    return { kind: 'found', details: { ...slot, restaurantName: restaurant?.name ?? '', amount: deposit.amount } }
  } catch (err) {
    deps.log('error', 'payment_link.details_failed', { depositId: deposit.id, error: (err as Error).name })
    return { kind: 'failed' }
  }
}

/** Best effort for the pages whose state does not depend on the booking: a failed read leaves them neutral. */
async function detailsOf(deps: ResolvePaymentLinkDeps, deposit: BookingDeposit): Promise<{ details?: PaymentLinkDetails }> {
  const read = await readDetails(deps, deposit)
  return read.kind === 'found' ? { details: read.details } : {}
}

/** A paid deposit's page depends on its booking: held (cancelled / no-show), refund due (declined), else paid. */
async function paidState(deps: ResolvePaymentLinkDeps, deposit: BookingDeposit): Promise<PaymentLinkState> {
  const read = await readDetails(deps, deposit)
  if (read.kind === 'none') return { kind: 'paid' }
  if (read.kind === 'failed') return { kind: 'unreadable' }
  const { details } = read
  if (KEEPABLE_BOOKING_STATUSES.includes(details.bookingStatus)) return { kind: 'held', details }
  if (details.bookingStatus === 'declined') return { kind: 'refund_due', details }
  return { kind: 'paid', details }
}

export async function resolvePaymentLink(
  deps: ResolvePaymentLinkDeps,
  input: { token: string; returned: 'success' | 'cancel' | null }
): Promise<PaymentLinkState> {
  if (!isPaymentLinkTokenShape(input.token)) return { kind: 'not_found' }
  const deposit = await deps.deposits.findByLinkTokenHash(hashPaymentLinkToken(input.token))
  if (!deposit) return { kind: 'not_found' }

  if (deposit.status === 'lapsed' || (deposit.status !== 'awaiting' && deposit.refundReason === 'late_payment')) return { kind: 'lapsed' }
  if (REFUNDING.includes(deposit.status)) return { kind: 'refunded', ...(await detailsOf(deps, deposit)) }
  if (deposit.status === 'kept') return { kind: 'closed' }
  if (deposit.status !== 'awaiting') return paidState(deps, deposit)
  // F3: hold over but not lapsed yet: a payment may still be accepted, so promise nothing.
  if (Date.parse(deposit.holdExpiresAt) <= deps.now().getTime()) return { kind: 'checking' }
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

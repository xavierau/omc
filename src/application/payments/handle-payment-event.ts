/**
 * BOOK-014 (spec AC-6, AC-7, AC-8; threat R49, R50, R57): one verified,
 * normalised provider event applied to our deposits.
 *
 * A payment counts ONLY when the deposit is found by the session id WE stored
 * and the event's account, amount, currency and paid flag all match it (R49);
 * provider metadata is never a lookup key. A mismatch is a security log line
 * and no change. The event's mode was checked by the caller (R50).
 *
 * - paid: deposit awaiting -> paid and booking awaiting_deposit -> pending
 *   (staff-made -> confirmed), once; then the channel hook (`onDepositPaid`,
 *   W3/W5 send the "received" message there).
 * - paid after the lapse: full automatic refund (spec AC-8, R57). A redelivery
 *   that finds that refund never issued (refund_pending, no refund id: the
 *   call or its result write failed) issues it again with the same attempt,
 *   so the same idempotency key (review finding 1a).
 * - an unknown session is not ours (e.g. another integration's Checkout on the
 *   same connected account): info log, ignored (review finding 7). A mismatch
 *   on a deposit we know stays a security log line.
 * - session expired: lapse that hold now if its time is up (else the cron does).
 * - refund events: settle a refund_pending deposit found by the payment ref we stored.
 * - account events (W2, R52): the account row found by the provider account id
 *   we stored takes the provider's status; deauthorized = disabled, and new
 *   bookings then take no deposit (AC-4). See payment-account.ts.
 */
import type { BookingDeposit } from '@/domain/entities/booking-deposit'
import type { BookingRequest } from '@/domain/entities/booking-request'
import type { BookingDepositStore, PaymentLog } from '@/domain/ports/booking-deposit'
import type { NormalizedPaymentEvent, PaymentGatewayRegistry, PaymentProviderCode } from '@/domain/ports/payment-gateway'
import { sameMoney } from '@/domain/value-objects/money'
import { issueRefund } from './issue-refund'
import { applyAccountEvent, type AccountEventDeps } from './payment-account'

export interface DepositPaid {
  deposit: BookingDeposit
  booking: BookingRequest
}

export interface HandlePaymentEventDeps {
  deposits: Pick<BookingDepositStore, 'findBySession' | 'findByPaymentRef' | 'markPaid' | 'lapseExpired' | 'finishRefund' | 'recordRefundRef'>
  registry: PaymentGatewayRegistry
  now: () => Date
  log: PaymentLog
  /** Channel hook after a booking moved out of awaiting_deposit. Its failure never undoes the payment. */
  onDepositPaid?: (paid: DepositPaid) => Promise<void>
  /** W2: the account store for account events; without it they are logged and ignored. */
  accounts?: AccountEventDeps['accounts']
}

export type PaymentEventOutcome =
  | 'paid'
  | 'late_refunded'
  | 'late_refund_failed'
  | 'duplicate'
  | 'lapsed'
  | 'refund_settled'
  | 'account_updated'
  | 'ignored'
  | 'rejected'

function reject(deps: HandlePaymentEventDeps, reason: string, data: Record<string, unknown>): PaymentEventOutcome {
  deps.log('warn', 'payment.security_mismatch', { reason, ...data })
  return 'rejected'
}

async function onPaymentSucceeded(
  deps: HandlePaymentEventDeps,
  code: PaymentProviderCode,
  event: Extract<NormalizedPaymentEvent, { type: 'payment_succeeded' }>
): Promise<PaymentEventOutcome> {
  const deposit = await deps.deposits.findBySession(code, event.sessionRef)
  const ids = { eventId: event.eventId, sessionRef: event.sessionRef }
  if (!deposit) {
    deps.log('info', 'payment.unrelated_session', ids)
    return 'ignored'
  }
  const at = { ...ids, depositId: deposit.id }
  if (event.accountRef !== deposit.providerAccountId) return reject(deps, 'account_mismatch', at)
  if (!event.amount || !sameMoney(event.amount, deposit.amount)) return reject(deps, 'amount_mismatch', at)
  if (!event.paid) {
    deps.log('info', 'payment.not_paid', at)
    return 'ignored'
  }
  if (!event.paymentRef) return reject(deps, 'no_payment_ref', at)

  const result = await deps.deposits.markPaid({ depositId: deposit.id, paymentRef: event.paymentRef, at: deps.now() })
  if (result.outcome === 'paid') {
    deps.log('info', 'deposit.paid', { depositId: deposit.id, bookingId: result.booking.id, bookingStatus: result.booking.status })
    if (deps.onDepositPaid) {
      try {
        await deps.onDepositPaid({ deposit: result.deposit, booking: result.booking })
      } catch (err) {
        deps.log('error', 'deposit.paid_hook_failed', { depositId: deposit.id, error: (err as Error).message })
      }
    }
    return 'paid'
  }
  if (result.outcome === 'late') {
    deps.log('warn', 'deposit.late_payment', { depositId: deposit.id })
    return lateRefund(deps, result.deposit)
  }
  if (result.outcome === 'duplicate' && lateRefundNeverIssued(result.deposit)) {
    deps.log('warn', 'deposit.late_refund_redriven', { depositId: deposit.id, attempt: result.deposit.refundAttempts })
    return lateRefund(deps, result.deposit)
  }
  return result.outcome === 'duplicate' ? 'duplicate' : 'ignored'
}

/** Finding 1a: the late-payment refund was claimed (refund_pending) but no refund id ever came back. */
function lateRefundNeverIssued(deposit: BookingDeposit): boolean {
  return deposit.status === 'refund_pending' && deposit.refundReason === 'late_payment' && deposit.refundRef === null
}

async function lateRefund(deps: HandlePaymentEventDeps, deposit: BookingDeposit): Promise<PaymentEventOutcome> {
  const refunded = await issueRefund(deps, deposit)
  return refunded.status === 'refund_failed' ? 'late_refund_failed' : 'late_refunded'
}

async function onPaymentExpired(
  deps: HandlePaymentEventDeps,
  code: PaymentProviderCode,
  event: Extract<NormalizedPaymentEvent, { type: 'payment_expired' }>
): Promise<PaymentEventOutcome> {
  const deposit = await deps.deposits.findBySession(code, event.sessionRef)
  if (!deposit) return 'ignored'
  if (event.accountRef !== deposit.providerAccountId) return reject(deps, 'account_mismatch', { eventId: event.eventId, depositId: deposit.id })
  if (deposit.status !== 'awaiting') return 'ignored'
  const lapsed = await deps.deposits.lapseExpired(1, deposit.id)
  return lapsed.length > 0 ? 'lapsed' : 'ignored'
}

async function onRefundEvent(
  deps: HandlePaymentEventDeps,
  code: PaymentProviderCode,
  event: Extract<NormalizedPaymentEvent, { type: 'refund_succeeded' | 'refund_failed' }>
): Promise<PaymentEventOutcome> {
  const deposit = await deps.deposits.findByPaymentRef(code, event.paymentRef)
  if (!deposit) return 'ignored'
  if (event.accountRef !== deposit.providerAccountId) return reject(deps, 'account_mismatch', { eventId: event.eventId, depositId: deposit.id })
  const finished = await deps.deposits.finishRefund({
    depositId: deposit.id,
    attempt: null,
    outcome: event.type === 'refund_succeeded' ? 'refunded' : 'refund_failed',
    refundRef: event.refundRef,
    actor: 'provider',
  })
  return finished ? 'refund_settled' : 'duplicate'
}

export async function handlePaymentEvent(
  deps: HandlePaymentEventDeps,
  code: PaymentProviderCode,
  event: NormalizedPaymentEvent
): Promise<PaymentEventOutcome> {
  switch (event.type) {
    case 'payment_succeeded':
      return onPaymentSucceeded(deps, code, event)
    case 'payment_expired':
      return onPaymentExpired(deps, code, event)
    case 'refund_succeeded':
    case 'refund_failed':
      return onRefundEvent(deps, code, event)
    case 'account_updated':
    case 'account_deauthorized':
      if (!deps.accounts) {
        deps.log('info', 'payment.account_event_ignored', { eventId: event.eventId, type: event.type })
        return 'ignored'
      }
      return applyAccountEvent({ accounts: deps.accounts, now: deps.now, log: deps.log }, code, event)
  }
}

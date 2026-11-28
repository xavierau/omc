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
 * - refund events: settle a refund_pending deposit found by the payment ref we
 *   stored, ONLY through a refund id we recorded (W6-fix F1). An id not
 *   recorded yet on a refund_pending deposit (the webhook beat
 *   recordRefundRef) is `retry_later`: the caller releases the claim and
 *   answers 503 so the provider redelivers (F4).
 * - payment refunded (Stripe charge.refunded, no refund named): settles none
 *   of our refunds (F1). A paid deposit with no refund attempt of ours that
 *   the provider confirms fully refunded, every refund succeeded, was refunded
 *   outside the app: refunded, provider_dashboard (F7). Anything else is logged.
 * - a late-payment refund that ends refund_failed at the attempt cap is logged
 *   at error level (W6-fix F2; the sweep retries it until then).
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
import { noteLateRefundFailure } from './late-refund-retries'
import { applyAccountEvent, type AccountEventDeps } from './payment-account'

export interface DepositPaid {
  deposit: BookingDeposit
  booking: BookingRequest
}

export interface HandlePaymentEventDeps {
  deposits: Pick<
    BookingDepositStore,
    'findBySession' | 'findByPaymentRef' | 'markPaid' | 'lapseExpired' | 'finishRefund' | 'recordRefundRef' | 'refundAttemptOf' | 'settleProviderRefund'
  >
  registry: PaymentGatewayRegistry
  now: () => Date
  log: PaymentLog
  /** Channel hook after a booking moved out of awaiting_deposit. Its failure never undoes the payment. */
  onDepositPaid?: (paid: DepositPaid) => Promise<void>
  /** W6a: told a hold the provider's "session expired" event lapsed (the AI agent's text); its failure is logged. */
  onLapsed?: (lapsed: BookingDeposit[]) => Promise<void>
  /** W2: the account store for account events (W6a: required, every composition passes it). */
  accounts: AccountEventDeps['accounts']
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
  /** W6-fix F4: not decidable yet; the claim is released and the provider redelivers. */
  | 'retry_later'

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
  noteLateRefundFailure(deps.log, refunded)
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
  if (lapsed.length === 0) return 'ignored'
  if (deps.onLapsed) {
    await deps.onLapsed(lapsed).catch((err: Error) => deps.log('warn', 'deposit.lapse_hook_failed', { depositId: deposit.id, error: err.name }))
  }
  return 'lapsed'
}

async function onRefundEvent(
  deps: HandlePaymentEventDeps,
  code: PaymentProviderCode,
  event: Extract<NormalizedPaymentEvent, { type: 'refund_succeeded' | 'refund_failed' }>
): Promise<PaymentEventOutcome> {
  const deposit = await deps.deposits.findByPaymentRef(code, event.paymentRef)
  if (!deposit) return 'ignored'
  if (event.accountRef !== deposit.providerAccountId) return reject(deps, 'account_mismatch', { eventId: event.eventId, depositId: deposit.id })
  // F4: our refund call has not recorded this id yet (the webhook won the race): decide on a redelivery.
  // Looked up BEFORE settling, so an id recorded in between is never read as "an earlier attempt".
  if (deposit.status === 'refund_pending' && (await deps.deposits.refundAttemptOf({ depositId: deposit.id, refundRef: event.refundRef })) === null) {
    deps.log('warn', 'payment.refund_ref_not_recorded_yet', { eventId: event.eventId, depositId: deposit.id, attempt: deposit.refundAttempts })
    return 'retry_later'
  }
  const finished = await deps.deposits.finishRefund({
    depositId: deposit.id,
    attempt: null,
    outcome: event.type === 'refund_succeeded' ? 'refunded' : 'refund_failed',
    refundRef: event.refundRef,
    actor: 'provider',
  })
  if (!finished) return 'duplicate'
  noteLateRefundFailure(deps.log, finished)
  return 'refund_settled'
}

/**
 * F1 / F7: the provider says the payment was refunded but names no refund (Stripe charge.refunded,
 * sent when a refund is created, pending or not). It never settles one of our attempts. A paid
 * deposit with no attempt of ours was refunded outside the app; it moves only once the provider
 * confirms the whole amount is back and every refund on it succeeded.
 */
async function onPaymentRefunded(
  deps: HandlePaymentEventDeps,
  code: PaymentProviderCode,
  event: Extract<NormalizedPaymentEvent, { type: 'payment_refunded' }>
): Promise<PaymentEventOutcome> {
  const deposit = await deps.deposits.findByPaymentRef(code, event.paymentRef)
  if (!deposit) return 'ignored'
  const at = { eventId: event.eventId, depositId: deposit.id }
  if (event.accountRef !== deposit.providerAccountId) return reject(deps, 'account_mismatch', at)
  if (deposit.status !== 'paid' || deposit.refundAttempts > 0) {
    deps.log('info', 'payment.refund_event_not_ours', { ...at, status: deposit.status, attempts: deposit.refundAttempts })
    return 'ignored'
  }
  if (!event.fullyRefunded) {
    deps.log('info', 'payment.provider_refund_not_settled', { ...at, reason: 'partial' })
    return 'ignored'
  }
  const confirmed = await deps.registry.get(code).confirmFullyRefunded({ accountRef: deposit.providerAccountId, paymentRef: event.paymentRef })
  if (!confirmed) {
    deps.log('info', 'payment.provider_refund_not_settled', { ...at, reason: 'not_all_succeeded' })
    return 'ignored'
  }
  const settled = await deps.deposits.settleProviderRefund({ depositId: deposit.id })
  if (!settled) return 'duplicate'
  deps.log('warn', 'deposit.refunded_outside_app', at)
  return 'refund_settled'
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
    case 'payment_refunded':
      return onPaymentRefunded(deps, code, event)
    case 'account_updated':
    case 'account_deauthorized':
      return applyAccountEvent({ accounts: deps.accounts, now: deps.now, log: deps.log }, code, event)
  }
}

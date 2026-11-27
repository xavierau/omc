/**
 * BOOK-014: the deposit of one booking (table `booking_deposits`, migration
 * 097). Every move is a conditional write in the database (CAS on the from
 * status, R56, R57); this module holds the vocabulary and the transition
 * table both the SQL and the in-memory fakes follow.
 *
 *   awaiting -> paid | lapsed
 *   lapsed -> refund_pending            (a payment after the lapse: late_payment, R57)
 *   paid -> refund_pending | kept       (decline / staff Refund; staff Keep)
 *   refund_pending -> refunded | refund_failed
 *   refund_failed -> refund_pending     (Retry)
 *   refund_failed -> refunded           (the provider confirms a refund we had marked failed)
 */
import type { PaymentProviderCode } from '@/domain/ports/payment-gateway'
import type { BookingStatus } from '@/domain/entities/booking-request'
import type { Money } from '@/domain/value-objects/money'

export type DepositStatus = 'awaiting' | 'paid' | 'lapsed' | 'refund_pending' | 'refunded' | 'refund_failed' | 'kept'
export type RefundReason = 'declined' | 'late_payment' | 'staff'
/** Who started the booking: a diner channel holds 30 minutes, staff 24 hours (spec Q3). */
export type DepositHolder = 'diner' | 'staff'

export const DEPOSIT_TRANSITIONS: Readonly<Record<DepositStatus, readonly DepositStatus[]>> = {
  awaiting: ['paid', 'lapsed'],
  lapsed: ['refund_pending'],
  paid: ['refund_pending', 'kept'],
  refund_pending: ['refunded', 'refund_failed'],
  refund_failed: ['refund_pending', 'refunded'],
  refunded: [],
  kept: [],
}

export function canTransition(from: DepositStatus, to: DepositStatus): boolean {
  return DEPOSIT_TRANSITIONS[from].includes(to)
}

/**
 * Spec AC-7 / Q3. A hosted session lives 30 minutes to 24 hours (Stripe Checkout), so both fit one
 * session. Staff: 24 h minus 2 min, under the adapter's session cap (24 h minus 1 min from creation),
 * so the session never expires before the hold (review finding 5).
 */
export const DINER_HOLD_MS = 30 * 60_000
export const STAFF_HOLD_MS = 24 * 60 * 60_000 - 2 * 60_000

export function holdMsFor(holder: DepositHolder): number {
  return holder === 'staff' ? STAFF_HOLD_MS : DINER_HOLD_MS
}

/** Spec AC-12, AC-13: staff refund a paid deposit only once the booking is not going ahead. */
export const REFUNDABLE_BOOKING_STATUSES: readonly BookingStatus[] = ['declined', 'cancelled', 'no_show']
/** Spec AC-13: Keep is offered on a cancelled or no-show booking only. */
export const KEEPABLE_BOOKING_STATUSES: readonly BookingStatus[] = ['cancelled', 'no_show']

export interface BookingDeposit {
  id: string
  restaurantId: string
  bookingId: string
  providerCode: PaymentProviderCode
  accountId: string | null
  /** Snapshot at creation: a payment event must come from this account (R49). */
  providerAccountId: string
  amount: Money
  status: DepositStatus
  holdExpiresAt: string
  providerSessionId: string | null
  sessionUrl: string | null
  providerPaymentRef: string | null
  paidAt: string | null
  refundRef: string | null
  refundReason: RefundReason | null
  refundAttempts: number
  decidedBy: string | null
  decidedAt: string | null
  createdAt: string
}

/** What the atomic booking + deposit insert writes (insert_booking_request_if_room, p_deposit). */
export interface NewDepositHold {
  id: string
  providerCode: PaymentProviderCode
  accountId: string
  providerAccountId: string
  amount: Money
  holdExpiresAt: string
  /** SHA-256 hex of the /p/<token> (R62); the token itself is never stored. */
  linkTokenHash: string
}

/** R60: who moved a deposit. */
export type DepositActor = { kind: 'user'; userId: string } | { kind: 'provider' } | { kind: 'cron' } | { kind: 'system' }

export function refundIdempotencyKey(depositId: string, attempt: number): string {
  return `refund:${depositId}:${attempt}`
}

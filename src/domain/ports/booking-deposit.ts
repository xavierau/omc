/**
 * BOOK-014: ports the deposit use cases depend on. The Supabase adapter is
 * `src/infrastructure/supabase/repositories/booking-deposit-repository.ts`
 * (migration 097 RPCs); tests use `src/test-utils/fake-booking-deposit.ts`,
 * which keeps the same CAS rules (first transition wins, loser gets null).
 *
 * Every staff-facing read and write is scoped by restaurant in the query
 * itself (R58; memory principle_authorize_by_scoped_query). Provider-facing
 * lookups use only references WE stored (R49): the session id, the payment
 * ref, the link token hash; never provider metadata.
 */
import type { BookingRequest, BookingStatus, NewBookingRequest } from '@/domain/entities/booking-request'
import type { BookingDeposit, DepositActor, NewDepositHold, RefundReason } from '@/domain/entities/booking-deposit'
import type { MerchantPaymentAccount } from '@/domain/entities/merchant-payment-account'
import type { PaymentProviderCode } from '@/domain/ports/payment-gateway'
import type { RoomCheck, RoomRefusal } from '@/domain/services/booking-room'

export type MarkDepositPaidResult =
  | { outcome: 'paid'; deposit: BookingDeposit; booking: BookingRequest }
  /** The hold lapsed first (R57): the deposit is refund_pending (late_payment) and must be refunded. */
  | { outcome: 'late'; deposit: BookingDeposit }
  | { outcome: 'duplicate'; deposit: BookingDeposit }
  | { outcome: 'not_found' }

export interface BeginRefundArgs {
  depositId: string
  restaurantId: string
  /** 'paid' = Refund / decline; 'refund_failed' = Retry. */
  from: 'paid' | 'refund_failed'
  reason: Exclude<RefundReason, 'late_payment'>
  /** 'paid' only moves while the booking is in one of these. */
  bookingStatuses: readonly BookingStatus[]
  actor: DepositActor
  at: Date
}

export interface FinishRefundArgs {
  depositId: string
  /** The attempt the refund call made; null = a refund webhook. */
  attempt: number | null
  outcome: 'refunded' | 'refund_failed'
  refundRef: string | null
  actor: Extract<DepositActor['kind'], 'provider' | 'system'>
}

export interface KeepDepositArgs {
  depositId: string
  restaurantId: string
  bookingStatuses: readonly BookingStatus[]
  actorUserId: string
  at: Date
}

export interface BookingDepositStore {
  findBySession(providerCode: PaymentProviderCode, sessionRef: string): Promise<BookingDeposit | null>
  findByPaymentRef(providerCode: PaymentProviderCode, paymentRef: string): Promise<BookingDeposit | null>
  findByLinkTokenHash(hash: string): Promise<BookingDeposit | null>
  /** R58: scoped by restaurant in the query; a foreign booking id is null. */
  findByBookingForRestaurant(restaurantId: string, bookingId: string): Promise<BookingDeposit | null>
  /** Stores the session once (awaiting, none stored yet); null when nothing changed. */
  attachSession(depositId: string, session: { sessionRef: string; url: string }): Promise<BookingDeposit | null>
  /** R54: the provider failed at submit; booking + hold lapse now. */
  abandon(depositId: string): Promise<BookingDeposit | null>
  /** R57: one transaction under the deposit row lock. */
  markPaid(args: { depositId: string; paymentRef: string; at: Date }): Promise<MarkDepositPaidResult>
  /** R55: lapses expired awaiting holds by the database clock; `depositId` narrows to one. */
  lapseExpired(limit: number, depositId?: string): Promise<BookingDeposit[]>
  /** R56: CAS; the winner gets the row with refundAttempts + 1, every other caller null. */
  beginRefund(args: BeginRefundArgs): Promise<BookingDeposit | null>
  finishRefund(args: FinishRefundArgs): Promise<BookingDeposit | null>
  /** A refund the provider accepted but has not settled: keep its id for the webhook. */
  recordRefundRef(args: { depositId: string; attempt: number; refundRef: string }): Promise<void>
  keep(args: KeepDepositArgs): Promise<BookingDeposit | null>
}

export type InsertWithDepositResult =
  | { ok: true; booking: BookingRequest; deposit: BookingDeposit }
  | { ok: false; refusal: RoomRefusal | { kind: 'pending_cap' } }

/**
 * Spec AC-5 / R54 / R55: a diner channel's booking + its deposit, written in
 * one transaction with the seat check and (when `maxPending` is given) the
 * per-phone cap (insert_booking_request_if_room, migration 097).
 */
export interface DepositBookingWriter {
  insertWithDeposit(request: NewBookingRequest, check: RoomCheck, hold: NewDepositHold, maxPending: number | null): Promise<InsertWithDepositResult>
}

export interface MerchantPaymentAccountReader {
  /** The restaurant's account for deposits (one per restaurant is used), any status. */
  findForRestaurant(restaurantId: string): Promise<MerchantPaymentAccount | null>
}

/** The webhook idempotency claim (processed_webhooks, R48). */
export interface WebhookClaimStore {
  claim(key: string): Promise<'new' | 'duplicate' | 'error'>
  release(key: string): Promise<void>
}

/** Server log for payments; the adapter redacts key-shaped strings (R63). */
export type PaymentLog = (level: 'info' | 'warn' | 'error', event: string, data?: Record<string, unknown>) => void

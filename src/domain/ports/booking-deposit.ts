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
import type { BookingRequest, BookingSource, BookingStatus, NewBookingRequest } from '@/domain/entities/booking-request'
import type { BookingDeposit, DepositActor, NewDepositHold, RefundReason } from '@/domain/entities/booking-deposit'
import type { MerchantAccountUpdate, MerchantPaymentAccount } from '@/domain/entities/merchant-payment-account'
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

/**
 * Review finding 2: a refund settles only through the attempt that created it.
 * - `attempt` set (the refund call of that attempt): settles only while that is the current attempt.
 * - `attempt` null (a refund webhook): `refundRef` is matched to the attempt it was recorded for;
 *   succeeded -> refunded from any attempt (the provider's word on money), failed -> refund_failed only
 *   for the current attempt; an id never recorded changes nothing. A null `refundRef` + refunded is the
 *   provider saying the payment is fully refunded, which ends refund_pending / refund_failed.
 */
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
  /**
   * Review finding 2: the refund id the provider returned for `attempt`, recorded as soon as it is
   * known (whatever its status), so a later webhook is matched to the attempt that made it. Also the
   * deposit's current refund id while that attempt is current and pending.
   */
  recordRefundRef(args: { depositId: string; attempt: number; refundRef: string }): Promise<void>
  /**
   * Review finding 1b: refund_pending deposits with no refund id whose last change is older than
   * `olderThanMs` by the database clock (a refund that was never issued), oldest first, at most `limit`.
   */
  listStalledRefunds(limit: number, olderThanMs: number): Promise<BookingDeposit[]>
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

/**
 * BOOK-014 W2 (R52, R58): the onboarding routes and the provider's account
 * events write the account. A provider account id is created server side and
 * stored here before any onboarding link exists; an event finds its row only
 * by the provider account id WE stored.
 */
export interface MerchantPaymentAccountStore extends MerchantPaymentAccountReader {
  findForRestaurantByProvider(restaurantId: string, providerCode: PaymentProviderCode): Promise<MerchantPaymentAccount | null>
  findByProviderAccount(providerCode: PaymentProviderCode, providerAccountId: string): Promise<MerchantPaymentAccount | null>
  /** A new pending account for the restaurant. If a concurrent connect stored one first, that row comes back instead. */
  link(input: { restaurantId: string; providerCode: PaymentProviderCode; providerAccountId: string }): Promise<MerchantPaymentAccount>
  /** A disconnected (or id-less) row gets a new provider account, back to pending; null when the row is no longer replaceable. */
  relink(input: { restaurantId: string; accountId: string; providerAccountId: string }): Promise<MerchantPaymentAccount | null>
  /** Writes a status onto the row only while it still holds `providerAccountId`; null when it no longer does. */
  applyStatus(input: { accountId: string; providerAccountId: string; update: MerchantAccountUpdate; at: Date }): Promise<MerchantPaymentAccount | null>
}

/**
 * BOOK-014 W6a (spec UI table, AI agent "Lapsed"): the bookings of holds that
 * just lapsed, so the AI agent's diners can be told. `personalAgent` is a
 * booking made through the PAP API (it carries a status token); source
 * 'agent' without it is the WhatsApp AI agent. Scoped by restaurant id.
 */
export interface LapsedHoldBooking {
  id: string
  restaurantId: string
  phone: string | null
  source: BookingSource
  personalAgent: boolean
  bookingDate: string
  /** HH:MM */
  bookingTime: string
  partySize: number
}

export interface LapsedHoldBookingReader {
  findForDeposits(refs: ReadonlyArray<{ restaurantId: string; bookingId: string }>): Promise<LapsedHoldBooking[]>
}

/** The webhook idempotency claim (processed_webhooks, R48). */
export interface WebhookClaimStore {
  claim(key: string): Promise<'new' | 'duplicate' | 'error'>
  release(key: string): Promise<void>
}

/** Server log for payments; the adapter redacts key-shaped strings (R63). */
export type PaymentLog = (level: 'info' | 'warn' | 'error', event: string, data?: Record<string, unknown>) => void

/**
 * BOOK-014: booking deposits (`booking_deposits`, migration 096).
 *
 * Every transition is one of 096's RPCs: a conditional write with its
 * deposit_events row in the same transaction (R56, R57, R60). Staff lookups
 * are scoped by restaurant in the query (R58); provider lookups use only the
 * references we stored (R49). 22P02 (not a uuid) is a miss, like an unknown id.
 */
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import type { BookingDeposit, DepositActor, NewDepositHold } from '@/domain/entities/booking-deposit'
import type { NewBookingRequest } from '@/domain/entities/booking-request'
import type {
  BeginRefundArgs,
  BookingDepositStore,
  DepositBookingWriter,
  FinishRefundArgs,
  InsertWithDepositResult,
  KeepDepositArgs,
  MarkDepositPaidResult,
} from '@/domain/ports/booking-deposit'
import type { PaymentProviderCode } from '@/domain/ports/payment-gateway'
import type { RoomCheck } from '@/domain/services/booking-room'
import { bookingInsertRow, toBookingRequest } from './booking-request-repository'

const DEPOSIT_COLUMNS =
  'id, restaurant_id, booking_id, account_id, provider_code, provider_account_id, amount_minor, currency, status, hold_expires_at, provider_session_id, session_url, provider_payment_ref, paid_at, refund_ref, refund_reason, refund_attempts, decided_by, decided_at, created_at'

interface DepositRow {
  id: string
  restaurant_id: string
  booking_id: string
  account_id: string | null
  provider_code: PaymentProviderCode
  provider_account_id: string
  amount_minor: number
  currency: string
  status: BookingDeposit['status']
  hold_expires_at: string
  provider_session_id: string | null
  session_url: string | null
  provider_payment_ref: string | null
  paid_at: string | null
  refund_ref: string | null
  refund_reason: BookingDeposit['refundReason']
  refund_attempts: number
  decided_by: string | null
  decided_at: string | null
  created_at: string
}

type BookingRow = Parameters<typeof toBookingRequest>[0]

export function toBookingDeposit(row: DepositRow): BookingDeposit {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    bookingId: row.booking_id,
    providerCode: row.provider_code,
    accountId: row.account_id,
    providerAccountId: row.provider_account_id,
    amount: { amountMinor: row.amount_minor, currency: row.currency },
    status: row.status,
    holdExpiresAt: row.hold_expires_at,
    providerSessionId: row.provider_session_id,
    sessionUrl: row.session_url,
    providerPaymentRef: row.provider_payment_ref,
    paidAt: row.paid_at,
    refundRef: row.refund_ref,
    refundReason: row.refund_reason,
    refundAttempts: row.refund_attempts,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
  }
}

/** The p_deposit object insert_booking_request_if_room accepts (exactly these keys). */
export function depositInsertRow(hold: NewDepositHold) {
  return {
    id: hold.id,
    provider_code: hold.providerCode,
    account_id: hold.accountId,
    provider_account_id: hold.providerAccountId,
    amount_minor: hold.amount.amountMinor,
    currency: hold.amount.currency,
    hold_expires_at: hold.holdExpiresAt,
    link_token_hash: hold.linkTokenHash,
  }
}

const firstDeposit = (data: unknown): BookingDeposit | null => {
  const row = ((data ?? []) as DepositRow[])[0]
  return row ? toBookingDeposit(row) : null
}

type QueryResult = PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>

async function single(query: QueryResult, label: string): Promise<BookingDeposit | null> {
  const { data, error } = await query
  if (error?.code === '22P02') return null
  if (error) throw new Error(`${label}: ${error.message}`)
  return data ? toBookingDeposit(data as DepositRow) : null
}

const deposits = () => createServerSupabaseClient().from('booking_deposits').select(DEPOSIT_COLUMNS)

export const findDepositBySession = (providerCode: PaymentProviderCode, sessionRef: string) =>
  single(deposits().eq('provider_code', providerCode).eq('provider_session_id', sessionRef).maybeSingle(), 'findDepositBySession')

export const findDepositByPaymentRef = (providerCode: PaymentProviderCode, paymentRef: string) =>
  single(deposits().eq('provider_code', providerCode).eq('provider_payment_ref', paymentRef).maybeSingle(), 'findDepositByPaymentRef')

export const findDepositByLinkTokenHash = (hash: string) =>
  single(deposits().eq('link_token_hash', hash).maybeSingle(), 'findDepositByLinkTokenHash')

/** R58: the restaurant is a filter of the query itself. */
export const findDepositByBookingForRestaurant = (restaurantId: string, bookingId: string) =>
  single(deposits().eq('restaurant_id', restaurantId).eq('booking_id', bookingId).maybeSingle(), 'findDepositByBookingForRestaurant')

async function rpcDeposits(fn: string, args: Record<string, unknown>): Promise<BookingDeposit[]> {
  const { data, error } = await createServerSupabaseClient().rpc(fn, args)
  if (error) throw new Error(`${fn}: ${error.message}`)
  return ((data ?? []) as DepositRow[]).map(toBookingDeposit)
}

const actorKind = (actor: DepositActor) => actor.kind
const actorUser = (actor: DepositActor) => (actor.kind === 'user' ? actor.userId : null)

export async function attachDepositSession(depositId: string, session: { sessionRef: string; url: string }) {
  return firstDeposit(
    await rpcDeposits('booking_deposit_attach_session', { p_deposit_id: depositId, p_session_id: session.sessionRef, p_session_url: session.url })
  )
}

export async function abandonDeposit(depositId: string) {
  return firstDeposit(await rpcDeposits('abandon_booking_deposit', { p_deposit_id: depositId }))
}

export async function lapseExpiredDeposits(limit: number, depositId?: string) {
  return rpcDeposits('lapse_expired_booking_deposits', { p_limit: limit, ...(depositId ? { p_deposit_id: depositId } : {}) })
}

interface MarkPaidRow {
  outcome: MarkDepositPaidResult['outcome']
  deposit?: DepositRow
  booking?: BookingRow
}

export async function markDepositPaid(args: { depositId: string; paymentRef: string; at: Date }): Promise<MarkDepositPaidResult> {
  const { data, error } = await createServerSupabaseClient().rpc('mark_booking_deposit_paid', {
    p_deposit_id: args.depositId,
    p_payment_ref: args.paymentRef,
    p_at: args.at.toISOString(),
  })
  if (error || !data) throw new Error(`markDepositPaid: ${error?.message ?? 'no result'}`)
  const result = data as MarkPaidRow
  if (result.outcome === 'not_found' || !result.deposit) return { outcome: 'not_found' }
  const deposit = toBookingDeposit(result.deposit)
  if (result.outcome === 'paid' && result.booking) return { outcome: 'paid', deposit, booking: toBookingRequest(result.booking) }
  return { outcome: result.outcome === 'late' ? 'late' : 'duplicate', deposit }
}

export async function beginDepositRefund(args: BeginRefundArgs) {
  return firstDeposit(
    await rpcDeposits('begin_booking_deposit_refund', {
      p_deposit_id: args.depositId,
      p_restaurant_id: args.restaurantId,
      p_from: args.from,
      p_reason: args.reason,
      p_booking_statuses: [...args.bookingStatuses],
      p_actor_kind: actorKind(args.actor),
      p_actor_user: actorUser(args.actor),
      p_at: args.at.toISOString(),
    })
  )
}

export async function finishDepositRefund(args: FinishRefundArgs) {
  return firstDeposit(
    await rpcDeposits('finish_booking_deposit_refund', {
      p_deposit_id: args.depositId,
      p_attempt: args.attempt,
      p_outcome: args.outcome,
      p_refund_ref: args.refundRef,
      p_actor_kind: args.actor,
    })
  )
}

export async function recordDepositRefundRef(args: { depositId: string; attempt: number; refundRef: string }): Promise<void> {
  const { error } = await createServerSupabaseClient()
    .from('booking_deposits')
    .update({ refund_ref: args.refundRef })
    .eq('id', args.depositId)
    .eq('status', 'refund_pending')
    .eq('refund_attempts', args.attempt)
    .is('refund_ref', null)
  if (error) throw new Error(`recordDepositRefundRef: ${error.message}`)
}

export async function keepDeposit(args: KeepDepositArgs) {
  return firstDeposit(
    await rpcDeposits('keep_booking_deposit', {
      p_deposit_id: args.depositId,
      p_restaurant_id: args.restaurantId,
      p_booking_statuses: [...args.bookingStatuses],
      p_actor_user: args.actorUserId,
      p_at: args.at.toISOString(),
    })
  )
}

interface InsertWithDepositRow {
  ok: boolean
  row?: BookingRow
  deposit?: DepositRow
  refusal?: Extract<InsertWithDepositResult, { ok: false }>['refusal']
}

/** Spec AC-5 / R54 / R55: booking (awaiting_deposit) + deposit + seat check + per-phone cap, one transaction. */
export async function insertBookingWithDeposit(
  request: NewBookingRequest,
  check: RoomCheck,
  hold: NewDepositHold,
  maxPending: number | null
): Promise<InsertWithDepositResult> {
  const { data, error } = await createServerSupabaseClient().rpc('insert_booking_request_if_room', {
    p_row: bookingInsertRow(request),
    p_period_key: check.periodKey,
    p_period_first: check.periodFirst,
    p_period_last: check.periodLast,
    p_slot_limit: check.perSlot,
    p_meal_limit: check.perMeal,
    p_status: 'awaiting_deposit',
    p_deposit: depositInsertRow(hold),
    p_max_pending: maxPending,
  })
  if (error || !data) throw new Error(`insertBookingWithDeposit: ${error?.message ?? 'no result'}`)
  const result = data as InsertWithDepositRow
  if (!result.ok || !result.row || !result.deposit) return { ok: false, refusal: result.refusal ?? { kind: 'pending_cap' } }
  return { ok: true, booking: toBookingRequest(result.row), deposit: toBookingDeposit(result.deposit) }
}

export const bookingDepositStore: BookingDepositStore = {
  findBySession: findDepositBySession,
  findByPaymentRef: findDepositByPaymentRef,
  findByLinkTokenHash: findDepositByLinkTokenHash,
  findByBookingForRestaurant: findDepositByBookingForRestaurant,
  attachSession: attachDepositSession,
  abandon: abandonDeposit,
  markPaid: markDepositPaid,
  lapseExpired: lapseExpiredDeposits,
  beginRefund: beginDepositRefund,
  finishRefund: finishDepositRefund,
  recordRefundRef: recordDepositRefundRef,
  keep: keepDeposit,
}

export const depositBookingWriter: DepositBookingWriter = { insertWithDeposit: insertBookingWithDeposit }

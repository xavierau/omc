/**
 * BOOK-014 (spec AC-12, AC-13; threat R56, R58, R60): what staff (and the
 * decline path) do with a paid deposit. W4 adds the routes and wires decline;
 * these are the use cases.
 *
 * Every lookup and move is scoped by restaurant in the query (R58): a foreign
 * booking id is `not_found` and no provider call is made. Each move is one
 * CAS: only the caller that wins paid -> refund_pending calls the provider
 * (R56); Refund after Keep, Keep after Refund and a second Refund are
 * `conflict` (409). Every move writes its deposit_events row with the staff
 * user (R60, in the SQL).
 */
import {
  KEEPABLE_BOOKING_STATUSES,
  REFUNDABLE_BOOKING_STATUSES,
  type BookingDeposit,
  type DepositStatus,
} from '@/domain/entities/booking-deposit'
import type { BookingDepositStore } from '@/domain/ports/booking-deposit'
import { issueRefund, type IssueRefundDeps } from './issue-refund'

export interface DepositDecisionDeps extends IssueRefundDeps {
  deposits: Pick<BookingDepositStore, 'findByBookingForRestaurant' | 'beginRefund' | 'finishRefund' | 'recordRefundRef' | 'keep'>
  now: () => Date
}

export interface DepositDecisionInput {
  restaurantId: string
  bookingId: string
  actorUserId: string
}

export type DepositDecisionResult =
  | { ok: true; deposit: BookingDeposit }
  | { ok: false; reason: 'not_found' }
  /** Nothing changed: the deposit (or its booking) is not in a state that allows this; `status` is what it is now. */
  | { ok: false; reason: 'conflict'; status: DepositStatus }

async function withDeposit(
  deps: DepositDecisionDeps,
  input: DepositDecisionInput,
  move: (deposit: BookingDeposit) => Promise<BookingDeposit | null>
): Promise<DepositDecisionResult> {
  const deposit = await deps.deposits.findByBookingForRestaurant(input.restaurantId, input.bookingId)
  if (!deposit) return { ok: false, reason: 'not_found' }
  const moved = await move(deposit)
  if (!moved) {
    const now = await deps.deposits.findByBookingForRestaurant(input.restaurantId, input.bookingId)
    return { ok: false, reason: 'conflict', status: now?.status ?? deposit.status }
  }
  return { ok: true, deposit: moved }
}

/**
 * Full refund of a paid deposit. `reason` 'declined' = the decline path (spec
 * AC-12), 'staff' = the Refund action on a cancelled / no-show booking (AC-13).
 */
export async function refundDeposit(
  deps: DepositDecisionDeps,
  input: DepositDecisionInput & { reason: 'declined' | 'staff' }
): Promise<DepositDecisionResult> {
  return withDeposit(deps, input, async (deposit) => {
    const begun = await deps.deposits.beginRefund({
      depositId: deposit.id,
      restaurantId: input.restaurantId,
      from: 'paid',
      reason: input.reason,
      bookingStatuses: REFUNDABLE_BOOKING_STATUSES,
      actor: { kind: 'user', userId: input.actorUserId },
      at: deps.now(),
    })
    return begun ? issueRefund(deps, begun) : null
  })
}

/** Retry after refund_failed: a new attempt, so a new idempotency key (R56). */
export async function retryDepositRefund(deps: DepositDecisionDeps, input: DepositDecisionInput): Promise<DepositDecisionResult> {
  return withDeposit(deps, input, async (deposit) => {
    const begun = await deps.deposits.beginRefund({
      depositId: deposit.id,
      restaurantId: input.restaurantId,
      from: 'refund_failed',
      reason: 'staff',
      bookingStatuses: [],
      actor: { kind: 'user', userId: input.actorUserId },
      at: deps.now(),
    })
    return begun ? issueRefund(deps, begun) : null
  })
}

/** Keep: terminal; records who and when (spec AC-13). */
export async function keepDeposit(deps: DepositDecisionDeps, input: DepositDecisionInput): Promise<DepositDecisionResult> {
  return withDeposit(deps, input, (deposit) =>
    deps.deposits.keep({
      depositId: deposit.id,
      restaurantId: input.restaurantId,
      bookingStatuses: KEEPABLE_BOOKING_STATUSES,
      actorUserId: input.actorUserId,
      at: deps.now(),
    })
  )
}

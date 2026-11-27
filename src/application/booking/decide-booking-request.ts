/**
 * BOOK-001: staff confirm or decline a pending request (spec AC-14).
 *
 * The status change is a conditional UPDATE scoped by the caller's restaurant
 * (R4, R6); the diner is messaged only when this call changed the row, so a
 * double tap sends one message. Who and when are stored on the row (R5), and
 * whether the message reached the diner (F9), so the "not delivered" badge
 * survives a reload; failing to store that never fails the decision.
 * Another tenant's id, or a missing one, is indistinguishable: not_found.
 *
 * AGENT-003 R23: a change request (made by the diner through the AI agent)
 * is decided here too. Confirm goes through one transaction that also
 * cancels the booking it replaces, and the diner gets "confirmed" for the
 * new slot. Decline leaves the original booking as it was and sends nothing,
 * so the diner never reads "declined" about a booking that still stands.
 * Every other booking (BOOK-001, BOOK-003) takes the path it always took.
 *
 * BOOK-013 (review R2): a booking whose staff unticked Notify (spec AC-2)
 * gets no confirm or decline message and no message outcome; nor does one
 * without a phone (decision 9, R19).
 *
 * BOOK-010 (spec AC-10): a confirm that would take the slot or meal over a
 * guest limit answers `over_limit` with the facts and changes nothing,
 * unless `confirmAnyway` is set; limits never block staff.
 *
 * BOOK-014 W4 (spec AC-12, R56): declining a booking whose deposit is paid
 * refunds it in full, after the decline is saved, through W1's refund use
 * case (reason 'declined', the staff user recorded, R60), and the decline
 * message says "Your deposit HK$X will be refunded". A refund the provider
 * refuses (or an error) never undoes the decline: the row shows Refund
 * failed + Retry (or Refund, if the refund never started).
 */
import {
  hasPhone,
  normalizeDeclineReason,
  type BookingDecision,
  type BookingRequest,
  type BookingWithPhone,
  type DecisionMessageStatus,
} from '@/domain/entities/booking-request'
import type { BookingMessageSender, BookingRequestStore, BookingSettingsReader } from '@/domain/ports/booking'
import { depositViewOf } from '@/domain/entities/booking-deposit'
import type { Money } from '@/domain/value-objects/money'
import { refundDeposit, type DepositDecisionDeps } from '@/application/payments/deposit-decisions'
import { overLimitFor, type OverLimit, type OverLimitDeps } from './booking-over-limit'

export interface DecideBookingDeps {
  requests: BookingRequestStore
  settings: Pick<BookingSettingsReader, 'getRestaurant'>
  sender: BookingMessageSender
  now(): Date
  /** BOOK-010: the over-limit question before a confirm; absent = never asked. */
  overLimit?: OverLimitDeps
  /** BOOK-014 W4: refunds a declined booking's paid deposit; absent = no deposits. */
  deposits?: DepositDecisionDeps
}

export interface DecideBookingInput {
  restaurantId: string
  userId: string
  bookingId: string
  decision: BookingDecision
  reason?: unknown
  /** BOOK-010 (spec AC-10): staff saw the over-limit facts and confirm anyway. */
  confirmAnyway?: boolean
}

/**
 * `delivered`: whether the decision message reached the diner; `null` when no
 * message is sent by design (a declined change request, AGENT-003 R23), so no
 * "not delivered" warning applies (review F8).
 */
export type DecideBookingResult =
  | { ok: true; booking: BookingRequest; delivered: boolean | null }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'already_handled'; status: BookingRequest['status'] }
  | { ok: false; reason: 'over_limit'; overLimit: OverLimit }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function notify(deps: DecideBookingDeps, booking: BookingWithPhone, depositRefund: Money | null): Promise<boolean> {
  const restaurant = await deps.settings.getRestaurant(booking.restaurantId)
  const result = await deps.sender.send({
    restaurantId: booking.restaurantId,
    phone: booking.phone,
    memberId: booking.memberId,
    kind: booking.status === 'confirmed' ? 'confirmed' : 'declined',
    details: {
      restaurantName: restaurant?.name ?? '',
      name: booking.name,
      date: booking.bookingDate,
      time: booking.bookingTime,
      partySize: booking.partySize,
      declineReason: booking.declineReason,
      depositRefund,
    },
  })
  return result.delivered
}

async function recordOutcome(deps: DecideBookingDeps, booking: BookingRequest, delivered: boolean): Promise<BookingRequest> {
  const status: DecisionMessageStatus = delivered ? 'delivered' : 'not_delivered'
  try {
    await deps.requests.recordDecisionMessage(booking.id, booking.restaurantId, status)
  } catch (err) {
    console.error('[Bookings] decision message status not stored:', { bookingId: booking.id, error: (err as Error).message })
  }
  return { ...booking, decisionMessageStatus: status }
}

async function decided(deps: DecideBookingDeps, booking: BookingRequest, depositRefund: Money | null = null): Promise<DecideBookingResult> {
  // R23: a declined change request is not news about the diner's booking; nothing is sent (F8: nothing undelivered either).
  if (booking.replacesBookingId && booking.status === 'declined') return { ok: true, booking, delivered: null }
  // BOOK-013 review R2: Notify off means no diner message from staff actions, a decision included.
  // BOOK-013 decision 9 (R19): no phone, no message and no outcome (the DB keeps Notify off too).
  if (booking.notifyDiner === false || !hasPhone(booking)) return { ok: true, booking, delivered: null }
  const delivered = await notify(deps, booking, depositRefund)
  return { ok: true, booking: await recordOutcome(deps, booking, delivered), delivered }
}

/**
 * BOOK-014 W4 (spec AC-12): after the decline is saved, the paid deposit is
 * refunded (one CAS winner calls the provider, R56). `amount` is set whenever
 * the deposit was paid, so the diner is told it will be refunded even when
 * the provider refused (staff Retry) or the refund could not start (staff Refund).
 */
async function refundOnDecline(deps: DecideBookingDeps, input: DecideBookingInput, booking: BookingRequest): Promise<{ booking: BookingRequest; amount: Money | null }> {
  const d = deps.deposits
  if (!d || booking.status !== 'declined') return { booking, amount: null }
  const scope = { restaurantId: input.restaurantId, bookingId: booking.id }
  const deposit = await d.deposits.findByBookingForRestaurant(scope.restaurantId, scope.bookingId).catch((err: Error) => {
    console.error('[Bookings] decline deposit lookup failed:', { bookingId: booking.id, error: err.message })
    return null
  })
  if (!deposit || deposit.status !== 'paid') return { booking, amount: null }
  try {
    const result = await refundDeposit(d, { ...scope, actorUserId: input.userId, reason: 'declined' })
    const now = result.ok ? result.deposit : await d.deposits.findByBookingForRestaurant(scope.restaurantId, scope.bookingId)
    return { booking: { ...booking, deposit: depositViewOf(now ?? deposit) }, amount: deposit.amount }
  } catch (err) {
    // The decline stands; the row offers Refund again (paid + declined).
    console.error('[Bookings] decline refund failed:', { bookingId: booking.id, error: (err as Error).message })
    return { booking: { ...booking, deposit: depositViewOf(deposit) }, amount: deposit.amount }
  }
}

/** BOOK-010 (spec AC-10): the facts when this confirm would go over a limit; null otherwise. */
async function overLimitOf(deps: DecideBookingDeps, input: DecideBookingInput): Promise<OverLimit | null> {
  if (!deps.overLimit || input.decision !== 'confirmed' || input.confirmAnyway === true) return null
  const booking = await deps.requests.findForRestaurant(input.bookingId, input.restaurantId)
  if (!booking) return null
  const original = booking.replacesBookingId ? await deps.requests.findForRestaurant(booking.replacesBookingId, input.restaurantId) : null
  return overLimitFor(deps.overLimit, booking, original)
}

export async function decideBookingRequest(deps: DecideBookingDeps, input: DecideBookingInput): Promise<DecideBookingResult> {
  if (!UUID.test(input.bookingId)) return { ok: false, reason: 'not_found' }
  const overLimit = await overLimitOf(deps, input)
  if (overLimit) return { ok: false, reason: 'over_limit', overLimit }
  if (input.decision === 'confirmed') {
    const change = await deps.requests.confirmChange({
      id: input.bookingId,
      restaurantId: input.restaurantId,
      decidedBy: input.userId,
      decidedAt: deps.now(),
    })
    if (change) return decided(deps, change)
  }
  const booking = await deps.requests.decide({
    id: input.bookingId,
    restaurantId: input.restaurantId,
    decision: input.decision,
    decidedBy: input.userId,
    decidedAt: deps.now(),
    declineReason: input.decision === 'declined' ? normalizeDeclineReason(input.reason) : null,
  })
  if (booking) {
    const refunded = await refundOnDecline(deps, input, booking)
    return decided(deps, refunded.booking, refunded.amount)
  }

  const current = await deps.requests.findForRestaurant(input.bookingId, input.restaurantId)
  return current ? { ok: false, reason: 'already_handled', status: current.status } : { ok: false, reason: 'not_found' }
}

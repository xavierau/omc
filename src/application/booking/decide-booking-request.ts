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
 */
import {
  normalizeDeclineReason,
  type BookingDecision,
  type BookingRequest,
  type DecisionMessageStatus,
} from '@/domain/entities/booking-request'
import type { BookingMessageSender, BookingRequestStore, BookingSettingsReader } from '@/domain/ports/booking'

export interface DecideBookingDeps {
  requests: BookingRequestStore
  settings: Pick<BookingSettingsReader, 'getRestaurant'>
  sender: BookingMessageSender
  now(): Date
}

export interface DecideBookingInput {
  restaurantId: string
  userId: string
  bookingId: string
  decision: BookingDecision
  reason?: unknown
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function notify(deps: DecideBookingDeps, booking: BookingRequest): Promise<boolean> {
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

async function decided(deps: DecideBookingDeps, booking: BookingRequest): Promise<DecideBookingResult> {
  // R23: a declined change request is not news about the diner's booking; nothing is sent (F8: nothing undelivered either).
  if (booking.replacesBookingId && booking.status === 'declined') return { ok: true, booking, delivered: null }
  const delivered = await notify(deps, booking)
  return { ok: true, booking: await recordOutcome(deps, booking, delivered), delivered }
}

export async function decideBookingRequest(deps: DecideBookingDeps, input: DecideBookingInput): Promise<DecideBookingResult> {
  if (!UUID.test(input.bookingId)) return { ok: false, reason: 'not_found' }
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
  if (booking) return decided(deps, booking)

  const current = await deps.requests.findForRestaurant(input.bookingId, input.restaurantId)
  return current ? { ok: false, reason: 'already_handled', status: current.status } : { ok: false, reason: 'not_found' }
}

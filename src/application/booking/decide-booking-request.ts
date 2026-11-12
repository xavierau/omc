/**
 * BOOK-001: staff confirm or decline a pending request (spec AC-14).
 *
 * The status change is a conditional UPDATE scoped by the caller's restaurant
 * (R4, R6); the diner is messaged only when this call changed the row, so a
 * double tap sends one message. Who and when are stored on the row (R5).
 * Another tenant's id, or a missing one, is indistinguishable: not_found.
 */
import { normalizeDeclineReason, type BookingDecision, type BookingRequest } from '@/domain/entities/booking-request'
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

export type DecideBookingResult =
  | { ok: true; booking: BookingRequest; delivered: boolean }
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

export async function decideBookingRequest(deps: DecideBookingDeps, input: DecideBookingInput): Promise<DecideBookingResult> {
  if (!UUID.test(input.bookingId)) return { ok: false, reason: 'not_found' }
  const booking = await deps.requests.decide({
    id: input.bookingId,
    restaurantId: input.restaurantId,
    decision: input.decision,
    decidedBy: input.userId,
    decidedAt: deps.now(),
    declineReason: input.decision === 'declined' ? normalizeDeclineReason(input.reason) : null,
  })
  if (booking) return { ok: true, booking, delivered: await notify(deps, booking) }

  const current = await deps.requests.findForRestaurant(input.bookingId, input.restaurantId)
  return current ? { ok: false, reason: 'already_handled', status: current.status } : { ok: false, reason: 'not_found' }
}

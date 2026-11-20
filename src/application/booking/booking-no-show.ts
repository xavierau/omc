/**
 * BOOK-007 (R5, R6): staff mark a past confirmed booking as a no-show, or
 * undo that. Each move is one conditional UPDATE scoped by the caller's
 * restaurant, so a double tap changes the row once and the loser learns the
 * current status (already_handled). Another tenant's id, a missing one or an
 * unverified agent booking (R41) is not_found. Nothing is sent to the diner:
 * these deps carry no message sender at all.
 */
import type { BookingRequest } from '@/domain/entities/booking-request'
import type { BookingNoShowStore } from '@/domain/ports/booking'
import { hongKongMoment } from '@/domain/services/booking-no-show'

export interface BookingNoShowDeps {
  store: BookingNoShowStore
  now(): Date
}

export interface NoShowInput {
  restaurantId: string
  userId: string
  bookingId: string
}

export type NoShowResult =
  | { ok: true; booking: BookingRequest }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'already_handled'; status: BookingRequest['status'] }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NOT_FOUND = { ok: false, reason: 'not_found' } as const

async function settle(deps: BookingNoShowDeps, input: NoShowInput, changed: BookingRequest | null): Promise<NoShowResult> {
  if (changed) return { ok: true, booking: changed }
  const current = await deps.store.findForRestaurant(input.bookingId, input.restaurantId)
  return current ? { ok: false, reason: 'already_handled', status: current.status } : NOT_FOUND
}

export async function markBookingNoShow(deps: BookingNoShowDeps, input: NoShowInput): Promise<NoShowResult> {
  if (!UUID.test(input.bookingId)) return NOT_FOUND
  const at = deps.now()
  const changed = await deps.store.markNoShow({
    id: input.bookingId,
    restaurantId: input.restaurantId,
    markedBy: input.userId,
    at,
    before: hongKongMoment(at),
  })
  return settle(deps, input, changed)
}

export async function undoBookingNoShow(deps: BookingNoShowDeps, input: NoShowInput): Promise<NoShowResult> {
  if (!UUID.test(input.bookingId)) return NOT_FOUND
  const changed = await deps.store.undoNoShow({ id: input.bookingId, restaurantId: input.restaurantId })
  return settle(deps, input, changed)
}

/**
 * BOOK-007 (R5, R6): staff mark a past confirmed booking as a no-show, or
 * undo that. Each move is one conditional UPDATE scoped by the caller's
 * restaurant, so a double tap changes the row once and the loser learns the
 * current status (already_handled; a confirmed booking not yet past is
 * not_past, one with an open change request change_pending, r1 F1/F3).
 * Another tenant's id, a missing one or an
 * unverified agent booking (R41) is not_found. Nothing is sent to the diner:
 * these deps carry no message sender at all.
 */
import type { BookingRequest } from '@/domain/entities/booking-request'
import type { BookingNoShowStore, HongKongMoment } from '@/domain/ports/booking'
import { hongKongMoment, isPastBooking } from '@/domain/services/booking-no-show'

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
  | { ok: false; reason: 'already_handled' | 'not_past' | 'change_pending' | 'checked_in'; status: BookingRequest['status'] }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NOT_FOUND = { ok: false, reason: 'not_found' } as const

type Refusal = (current: BookingRequest) => 'already_handled' | 'not_past' | 'change_pending' | 'checked_in'

const ALREADY_HANDLED: Refusal = () => 'already_handled'

/**
 * r1 F1/F3: why a mark changed nothing. The RPC's WHERE is confirmed AND past
 * AND no pending change; so a row still confirmed was either not past by the
 * same `before`, or (past) had a pending change request replacing it.
 */
const markRefusal = (before: HongKongMoment): Refusal => (current) => {
  if (current.status !== 'confirmed') return 'already_handled'
  // BOOK-013 (R14): an arrived diner is never a no-show (095 adds checked_in_at IS NULL to the RPC).
  if (current.checkedInAt) return 'checked_in'
  return isPastBooking(current, before) ? 'change_pending' : 'not_past'
}

async function settle(deps: BookingNoShowDeps, input: NoShowInput, changed: BookingRequest | null, why: Refusal): Promise<NoShowResult> {
  if (changed) return { ok: true, booking: changed }
  const current = await deps.store.findForRestaurant(input.bookingId, input.restaurantId)
  return current ? { ok: false, reason: why(current), status: current.status } : NOT_FOUND
}

export async function markBookingNoShow(deps: BookingNoShowDeps, input: NoShowInput): Promise<NoShowResult> {
  if (!UUID.test(input.bookingId)) return NOT_FOUND
  const at = deps.now()
  const before = hongKongMoment(at)
  const changed = await deps.store.markNoShow({ id: input.bookingId, restaurantId: input.restaurantId, markedBy: input.userId, at, before })
  return settle(deps, input, changed, markRefusal(before))
}

export async function undoBookingNoShow(deps: BookingNoShowDeps, input: NoShowInput): Promise<NoShowResult> {
  if (!UUID.test(input.bookingId)) return NOT_FOUND
  const changed = await deps.store.undoNoShow({ id: input.bookingId, restaurantId: input.restaurantId })
  return settle(deps, input, changed, ALREADY_HANDLED)
}

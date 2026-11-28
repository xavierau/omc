/**
 * BOOK-013 S7: the Today view's reads and the Arrived / Undo moves.
 *
 * Arrived only on a confirmed booking dated today (Hong Kong), not yet
 * arrived, with no open change (R14); undo clears it. Each is one
 * conditional statement with its events row (R3, R9), scoped by the
 * session's restaurant (R2, AC-24). Mode off refuses Arrived and Undo like
 * every staff write (R6).
 */
import type { BookingRequest } from '@/domain/entities/booking-request'
import type { BookingSettingsReader } from '@/domain/ports/booking'
import type { CheckinStore } from '@/domain/ports/staff-booking'
import { TODAY_LIST_CAP } from '@/domain/services/booking-checkin'
import { hongKongToday } from '@/domain/services/booking-submission'
import { UUID } from './staff-booking-shared'

export interface BookingCheckInDeps {
  store: CheckinStore
  settings: Pick<BookingSettingsReader, 'getConfig'>
  now(): Date
}

export interface CheckInInput {
  restaurantId: string
  userId: string
  bookingId: string
}

export type CheckInRefusal = 'not_today' | 'not_confirmed' | 'already_arrived' | 'open_change'

export type CheckInResult =
  | { ok: true; booking: BookingRequest }
  | { ok: false; reason: 'booking_off' | 'not_found' }
  | { ok: false; reason: CheckInRefusal | 'not_arrived'; status: BookingRequest['status'] }

/** Why an Arrived changed nothing, from the row as it is now. */
function checkInRefusal(b: BookingRequest, today: string): CheckInRefusal {
  if (b.status !== 'confirmed') return 'not_confirmed'
  if (b.checkedInAt) return 'already_arrived'
  if (b.bookingDate !== today) return 'not_today'
  return 'open_change'
}

async function guard(deps: BookingCheckInDeps, input: CheckInInput): Promise<CheckInResult | null> {
  if ((await deps.settings.getConfig(input.restaurantId)).mode === 'off') return { ok: false, reason: 'booking_off' }
  return UUID.test(input.bookingId) ? null : { ok: false, reason: 'not_found' }
}

export async function checkInBooking(deps: BookingCheckInDeps, input: CheckInInput): Promise<CheckInResult> {
  const refused = await guard(deps, input)
  if (refused) return refused
  const at = deps.now()
  const today = hongKongToday(at)
  const done = await deps.store.checkIn({ id: input.bookingId, restaurantId: input.restaurantId, today, actorUserId: input.userId, at })
  if (done) return { ok: true, booking: done }
  const current = await deps.store.find(input.bookingId, input.restaurantId)
  return current ? { ok: false, reason: checkInRefusal(current, today), status: current.status } : { ok: false, reason: 'not_found' }
}

export async function undoCheckIn(deps: BookingCheckInDeps, input: CheckInInput): Promise<CheckInResult> {
  const refused = await guard(deps, input)
  if (refused) return refused
  const done = await deps.store.undoCheckIn({ id: input.bookingId, restaurantId: input.restaurantId, actorUserId: input.userId })
  if (done) return { ok: true, booking: done }
  const current = await deps.store.find(input.bookingId, input.restaurantId)
  return current ? { ok: false, reason: 'not_arrived', status: current.status } : { ok: false, reason: 'not_found' }
}

/** Spec S7 / R12: today's list, capped. */
export async function listTodayBookings(deps: BookingCheckInDeps, restaurantId: string) {
  const today = hongKongToday(deps.now())
  return { date: today, ...(await deps.store.listForDate(restaurantId, today, TODAY_LIST_CAP)) }
}

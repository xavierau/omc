/**
 * BOOK-010 (migration 092): guest counts, staff stops and the atomic
 * check-and-insert. Every query is scoped by restaurant_id inside the query
 * (memory: principle_authorize_by_scoped_query); the functions are service
 * role only (threat R5).
 *
 * - `readRoom`: ONE grouped count (booking_guest_counts, a JSON value, so
 *   PostgREST max_rows never cuts it) plus the stops of the range.
 * - `insertIfRoom`: insert_booking_request_if_room locks (restaurant, date),
 *   counts, checks stops and inserts, or refuses; the row is the plain
 *   insert's row (`bookingInsertRow`).
 * - stops: add is idempotent (the unique constraint makes a second stop a
 *   no-op) and answers with the stored row; remove deletes the one matching row.
 */
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import type { BookingRoomStore, BookingStopStore, InsertIfRoomResult } from '@/domain/ports/booking'
import type { NewBookingRequest } from '@/domain/entities/booking-request'
import type { BookingStop, GuestCounts, RoomCheck, RoomRefusal, RoomState, StopTarget } from '@/domain/services/booking-room'
import { bookingInsertRow, toBookingRequest } from './booking-request-repository'

const STOP_COLUMNS = 'booking_date, scope, period_label, slot_time, stopped_by, stopped_by_name, stopped_at'

interface StopRow {
  booking_date: string
  scope: BookingStop['scope']
  period_label: string | null
  slot_time: string | null
  stopped_by: string | null
  stopped_by_name: string | null
  stopped_at: string
}

const toStop = (r: StopRow): BookingStop => ({
  date: r.booking_date, scope: r.scope, periodLabel: r.period_label, time: r.slot_time,
  stoppedById: r.stopped_by, stoppedByName: r.stopped_by_name, stoppedAt: r.stopped_at,
})

export async function readBookingRoom(restaurantId: string, from: string, to: string): Promise<RoomState> {
  const supabase = createServerSupabaseClient()
  const [counts, stops] = await Promise.all([
    supabase.rpc('booking_guest_counts', { p_restaurant_id: restaurantId, p_from: from, p_to: to }),
    supabase
      .from('booking_stops')
      .select(STOP_COLUMNS)
      .eq('restaurant_id', restaurantId)
      .gte('booking_date', from)
      .lte('booking_date', to),
  ])
  const error = counts.error ?? stops.error
  if (error) throw new Error(`readBookingRoom: ${error.message}`)
  return { counts: (counts.data ?? {}) as GuestCounts, stops: ((stops.data ?? []) as StopRow[]).map(toStop) }
}

type InsertIfRoomRow = { ok: true; row: Parameters<typeof toBookingRequest>[0] } | { ok: false; refusal: RoomRefusal }

export async function insertBookingRequestIfRoom(request: NewBookingRequest, check: RoomCheck): Promise<InsertIfRoomResult> {
  const { data, error } = await createServerSupabaseClient().rpc('insert_booking_request_if_room', {
    p_row: bookingInsertRow(request),
    p_period_key: check.periodKey,
    p_period_first: check.periodFirst,
    p_period_last: check.periodLast,
    p_slot_limit: check.perSlot,
    p_meal_limit: check.perMeal,
  })
  // The unique-index message (one open change per booking, token) is kept for the callers' checks.
  if (error || !data) throw new Error(`insertBookingRequestIfRoom: ${error?.message ?? 'no result'}`)
  const result = data as InsertIfRoomRow
  return result.ok ? { ok: true, booking: toBookingRequest(result.row) } : { ok: false, refusal: result.refusal }
}

const targetFilter = (restaurantId: string, t: StopTarget) => ({
  restaurant_id: restaurantId, booking_date: t.date, scope: t.scope, period_label: t.periodLabel, slot_time: t.time,
})

/** The stop row that matches `target` for the restaurant (NULL-aware on label and time). */
async function findStop(restaurantId: string, target: StopTarget): Promise<BookingStop> {
  let query = createServerSupabaseClient()
    .from('booking_stops')
    .select(STOP_COLUMNS)
    .eq('restaurant_id', restaurantId)
    .eq('booking_date', target.date)
    .eq('scope', target.scope)
  query = target.periodLabel === null ? query.is('period_label', null) : query.eq('period_label', target.periodLabel)
  query = target.time === null ? query.is('slot_time', null) : query.eq('slot_time', target.time)
  const { data, error } = await query.maybeSingle()
  if (error || !data) throw new Error(`addBookingStop: stored stop not found${error ? `: ${error.message}` : ''}`)
  return toStop(data as StopRow)
}

export async function addBookingStop(restaurantId: string, stop: BookingStop): Promise<BookingStop> {
  const { data, error } = await createServerSupabaseClient()
    .from('booking_stops')
    .insert({ ...targetFilter(restaurantId, stop), stopped_by: stop.stoppedById, stopped_by_name: stop.stoppedByName, stopped_at: stop.stoppedAt })
    .select(STOP_COLUMNS)
    .single()
  // booking_stops_one: already stopped, so the stop stands (idempotent); answer with the stored row (F1, review P3-3).
  if (error?.code === '23505') return findStop(restaurantId, stop)
  if (error || !data) throw new Error(`addBookingStop: ${error?.message ?? 'no row'}`)
  return toStop(data as StopRow)
}

export async function removeBookingStop(restaurantId: string, target: StopTarget): Promise<void> {
  let query = createServerSupabaseClient()
    .from('booking_stops')
    .delete()
    .eq('restaurant_id', restaurantId)
    .eq('booking_date', target.date)
    .eq('scope', target.scope)
  query = target.periodLabel === null ? query.is('period_label', null) : query.eq('period_label', target.periodLabel)
  query = target.time === null ? query.is('slot_time', null) : query.eq('slot_time', target.time)
  const { error } = await query
  if (error) throw new Error(`removeBookingStop: ${error.message}`)
}

/** "Stopped by": the staff member's email name (before @), as the dashboard knows them; null when unknown. */
export async function findStaffDisplayName(userId: string): Promise<string | null> {
  try {
    const { data, error } = await createServerSupabaseClient().auth.admin.getUserById(userId)
    const email = error ? null : (data.user?.email ?? null)
    return email ? email.split('@')[0].slice(0, 100) || null : null
  } catch {
    return null
  }
}

export const bookingRoomStore: BookingRoomStore = { readRoom: readBookingRoom, insertIfRoom: insertBookingRequestIfRoom }
export const bookingStopStore: BookingStopStore = { add: addBookingStop, remove: removeBookingStop }

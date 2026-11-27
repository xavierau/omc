/**
 * BOOK-013: staff create / edit / cancel and check-in (migration 095 RPCs).
 *
 * Every read and write is scoped by `restaurant_id` inside the query or the
 * RPC's WHERE (R2; memory: principle_authorize_by_scoped_query). Each write is
 * one conditional statement with its events row (R3, R9): no row back means
 * nothing changed, and the caller re-reads to say why.
 */
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { STAFF_HIDDEN_STATUS_FILTER, type BookingRequest } from '@/domain/entities/booking-request'
import type {
  CheckInArgs,
  CheckinStore,
  StaffBookingStore,
  StaffCancelArgs,
  StaffCreateArgs,
  StaffUpdateArgs,
} from '@/domain/ports/staff-booking'
import { STAFF_COLUMNS, toBookingRequest, withChangeSlots } from './booking-request-repository'

type Row = Parameters<typeof toBookingRequest>[0]

const firstRow = (data: unknown): BookingRequest | null => {
  const row = ((data ?? []) as Row[])[0]
  return row ? toBookingRequest(row) : null
}

/** One booking of this restaurant (never an unverified one, BOOK-014: nor a deposit hold or lapsed one), with its BOOK-006 open change. */
export async function findStaffBooking(id: string, restaurantId: string): Promise<BookingRequest | null> {
  const { data, error } = await createServerSupabaseClient()
    .from('booking_requests')
    .select(STAFF_COLUMNS)
    .eq('id', id)
    .eq('restaurant_id', restaurantId)
    .not('status', 'in', STAFF_HIDDEN_STATUS_FILTER)
    .maybeSingle()
  if (error) throw new Error(`findStaffBooking: ${error.message}`)
  if (!data) return null
  const [booking] = await withChangeSlots(restaurantId, [toBookingRequest(data as Row)])
  return booking
}

async function createStaffBooking(args: StaffCreateArgs): Promise<BookingRequest> {
  const { input } = args
  const { data, error } = await createServerSupabaseClient()
    .rpc('staff_create_booking', {
      p_restaurant_id: args.restaurantId,
      p_member_id: args.memberId,
      p_phone: input.phone,
      p_name: input.name,
      p_party: input.partySize,
      p_date: input.date,
      p_time: input.time,
      p_notes: input.notes,
      p_notify: input.notify,
      p_actor: args.actorUserId,
      p_at: args.at.toISOString(),
      p_broken_rules: args.brokenRules,
    })
    .select(STAFF_COLUMNS)
  if (error) throw new Error(`createStaffBooking: ${error.message}`)
  const booking = firstRow(data)
  if (!booking) throw new Error('createStaffBooking: no row')
  return booking
}

async function updateStaffBooking(args: StaffUpdateArgs): Promise<BookingRequest | null> {
  const { input } = args
  const { data, error } = await createServerSupabaseClient()
    .rpc('staff_update_booking', {
      p_id: args.id,
      p_restaurant_id: args.restaurantId,
      p_expected_status: args.expectedStatus,
      p_expected_version: args.expectedVersion,
      p_member_id: args.memberId,
      p_phone: input.phone,
      p_name: input.name,
      p_party: input.partySize,
      p_date: input.date,
      p_time: input.time,
      p_notes: input.notes,
      p_notify: input.notify,
      p_clear_reminder: args.clearReminder,
      p_actor: args.actorUserId,
      p_changed: args.changed,
      p_broken_rules: args.brokenRules,
    })
    .select(STAFF_COLUMNS)
  if (error) throw new Error(`updateStaffBooking: ${error.message}`)
  return firstRow(data)
}

async function cancelStaffBooking(args: StaffCancelArgs): Promise<BookingRequest | null> {
  const { data, error } = await createServerSupabaseClient()
    .rpc('staff_cancel_booking', {
      p_id: args.id,
      p_restaurant_id: args.restaurantId,
      p_expected_version: args.expectedVersion,
      p_actor: args.actorUserId,
      p_at: args.at.toISOString(),
    })
    .select(STAFF_COLUMNS)
  if (error) throw new Error(`cancelStaffBooking: ${error.message}`)
  return firstRow(data)
}

/** R11: one conditional UPDATE; true only when no staff message went to this diner in the last `gapMs`. */
async function claimStaffMessage(id: string, restaurantId: string, at: Date, gapMs: number): Promise<boolean> {
  const cutoff = new Date(at.getTime() - gapMs).toISOString()
  const { data, error } = await createServerSupabaseClient()
    .from('booking_requests')
    .update({ last_staff_message_at: at.toISOString() })
    .eq('id', id)
    .eq('restaurant_id', restaurantId)
    .or(`last_staff_message_at.is.null,last_staff_message_at.lt.${cutoff}`)
    .select('id')
  if (error) throw new Error(`claimStaffMessage: ${error.message}`)
  return (data ?? []).length === 1
}

export const staffBookingStore: StaffBookingStore = {
  find: findStaffBooking,
  create: createStaffBooking,
  update: updateStaffBooking,
  cancel: cancelStaffBooking,
  claimStaffMessage,
}

/** R12: one date's pending, confirmed and no-show bookings, by time, reading one past `cap`. */
async function listForDate(restaurantId: string, date: string, cap: number) {
  const { data, error } = await createServerSupabaseClient()
    .from('booking_requests')
    .select(STAFF_COLUMNS)
    .eq('restaurant_id', restaurantId)
    .eq('booking_date', date)
    .in('status', ['pending', 'confirmed', 'no_show'])
    .order('booking_time', { ascending: true })
    .limit(cap + 1)
  if (error) throw new Error(`listTodayBookings: ${error.message}`)
  const rows = (data ?? []) as Row[]
  const bookings = await withChangeSlots(restaurantId, rows.slice(0, cap).map(toBookingRequest))
  return { bookings, truncated: rows.length > cap }
}

async function checkIn(args: CheckInArgs): Promise<BookingRequest | null> {
  const { data, error } = await createServerSupabaseClient()
    .rpc('booking_check_in', {
      p_id: args.id,
      p_restaurant_id: args.restaurantId,
      p_today: args.today,
      p_actor: args.actorUserId,
      p_at: args.at.toISOString(),
    })
    .select(STAFF_COLUMNS)
  if (error) throw new Error(`checkInBooking: ${error.message}`)
  return firstRow(data)
}

async function undoCheckIn(args: { id: string; restaurantId: string; actorUserId: string }): Promise<BookingRequest | null> {
  const { data, error } = await createServerSupabaseClient()
    .rpc('booking_check_in_undo', { p_id: args.id, p_restaurant_id: args.restaurantId, p_actor: args.actorUserId })
    .select(STAFF_COLUMNS)
  if (error) throw new Error(`undoCheckIn: ${error.message}`)
  return firstRow(data)
}

export const checkinStore: CheckinStore = { listForDate, find: findStaffBooking, checkIn, undoCheckIn }

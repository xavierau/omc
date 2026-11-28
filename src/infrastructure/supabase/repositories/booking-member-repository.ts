/**
 * BOOK-008: the booking ↔ member link (manual relink) and a member's bookings
 * for the member panel. Every query is scoped by restaurant inside the query
 * itself (R2; memory principle_authorize_by_scoped_query). The relink and the
 * stats are RPCs from migration 088, executable by service_role only:
 * relink_booking_member writes the compare-and-set UPDATE and its audit row in
 * one statement (R4); member_booking_stats counts every booking of the member
 * in SQL (R8). The list is capped by the caller (newest 50) and never takes an
 * id list (memory principle_postgrest_in_filter_header_overflow).
 */
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import type { MemberBookingItem, MemberBookingStats } from '@/domain/entities/member-booking'
import { STAFF_HIDDEN_STATUS_FILTER, STAFF_HOLD_FILTER } from '@/domain/entities/booking-request'
import type { HongKongMoment } from '@/domain/ports/booking'
import type { BookingMemberLinkStore, MemberBookingsReader, RelinkBookingMemberArgs } from '@/domain/ports/booking-member'
import { STAFF_COLUMNS, toBookingRequest } from './booking-request-repository'

type BookingRow = Parameters<typeof toBookingRequest>[0]

/**
 * r1 F6: the relink's booking read uses the same staff columns as the RPC's
 * answer, so PATCH returns one booking shape on a no-op and on a change.
 * Never an unverified agent booking (BOOK-003 R41), nor a lapsed one or a diner's BOOK-014 deposit hold
 * (a staff-made hold is shown, W4); 22P02 = not a uuid: a miss.
 */
export async function findStaffBookingForRestaurant(id: string, restaurantId: string) {
  const { data, error } = await createServerSupabaseClient()
    .from('booking_requests')
    .select(STAFF_COLUMNS)
    .eq('id', id)
    .eq('restaurant_id', restaurantId)
    .not('status', 'in', STAFF_HIDDEN_STATUS_FILTER)
    .or(STAFF_HOLD_FILTER)
    .maybeSingle()
  if (error?.code === '22P02') return null
  if (error) throw new Error(`findStaffBookingForRestaurant: ${error.code}`)
  return data ? toBookingRequest(data as BookingRow) : null
}

/** 22P02 = not a uuid: a miss, like an unknown id. */
export async function memberExistsForRestaurant(memberId: string, restaurantId: string): Promise<boolean> {
  const { data, error } = await createServerSupabaseClient()
    .from('members')
    .select('id')
    .eq('id', memberId)
    .eq('restaurant_id', restaurantId)
    .maybeSingle()
  if (error?.code === '22P02') return false
  if (error) throw new Error(`memberExistsForRestaurant: ${error.code}`)
  return !!data
}

export async function relinkBookingMember(args: RelinkBookingMemberArgs) {
  const { data, error } = await createServerSupabaseClient()
    .rpc('relink_booking_member', {
      p_id: args.id,
      p_restaurant_id: args.restaurantId,
      p_from_member_id: args.fromMemberId,
      p_to_member_id: args.toMemberId,
      p_actor_user_id: args.actorUserId,
    })
    .select(STAFF_COLUMNS)
  if (error) throw new Error(`relinkBookingMember: ${error.code}`)
  const row = ((data ?? []) as BookingRow[])[0]
  return row ? toBookingRequest(row) : null
}

interface MemberBookingRow {
  id: string
  booking_date: string
  booking_time: string
  party_size: number
  status: MemberBookingItem['status']
}

const MEMBER_HIDDEN_STATUS_FILTER = `(${[...STAFF_HIDDEN_STATUS_FILTER.slice(1, -1).split(','), 'awaiting_deposit'].join(',')})`

export async function listMemberBookings(memberId: string, restaurantId: string, limit: number): Promise<MemberBookingItem[]> {
  const { data, error } = await createServerSupabaseClient()
    .from('booking_requests')
    .select('id, booking_date, booking_time, party_size, status')
    .eq('restaurant_id', restaurantId)
    .eq('member_id', memberId)
    // BOOK-014: the member history skips every deposit hold, as member_booking_stats (097) does.
    .not('status', 'in', MEMBER_HIDDEN_STATUS_FILTER)
    .order('booking_date', { ascending: false })
    .order('booking_time', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`listMemberBookings: ${error.code}`)
  return ((data ?? []) as MemberBookingRow[]).map((r) => ({
    id: r.id,
    bookingDate: r.booking_date,
    bookingTime: r.booking_time.slice(0, 5),
    partySize: r.party_size,
    status: r.status,
  }))
}

interface StatsRow {
  total: number
  confirmed: number
  cancelled: number
  declined: number
  no_show: number
  pending: number
  /** BOOK-013 (095): absent before the migration. */
  arrived?: number
  last_booking_date: string | null
  next_booking_date: string | null
}

export async function memberBookingStats(memberId: string, restaurantId: string, now: HongKongMoment): Promise<MemberBookingStats> {
  const { data, error } = await createServerSupabaseClient().rpc('member_booking_stats', {
    p_member_id: memberId,
    p_restaurant_id: restaurantId,
    p_now_date: now.date,
    p_now_time: now.time,
  })
  if (error) throw new Error(`memberBookingStats: ${error.code}`)
  const row = ((data ?? []) as StatsRow[])[0]
  if (!row) throw new Error('memberBookingStats: no row')
  return {
    total: row.total,
    confirmed: row.confirmed,
    cancelled: row.cancelled,
    declined: row.declined,
    noShow: row.no_show,
    pending: row.pending,
    arrived: row.arrived ?? 0,
    lastBookingDate: row.last_booking_date,
    nextBookingDate: row.next_booking_date,
  }
}

export const bookingMemberLinkStore: BookingMemberLinkStore = {
  findBooking: findStaffBookingForRestaurant,
  memberExists: memberExistsForRestaurant,
  relink: relinkBookingMember,
}

export const memberBookingsReader: MemberBookingsReader = {
  list: listMemberBookings,
  stats: memberBookingStats,
}

/**
 * BOOK-001: booking requests (`booking_requests`, migration 082).
 *
 * Every dashboard read and write is scoped by `restaurant_id` inside the
 * query itself (R6; memory: principle_authorize_by_scoped_query). A decision
 * is one conditional UPDATE on `status = 'pending'`, so two staff tapping at
 * once change the row once (R4) and the loser gets null.
 */
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import type {
  BookingCancelledBy,
  BookingDateRange,
  BookingRequest,
  DecisionMessageStatus,
  DinerBooking,
  NewBookingRequest,
} from '@/domain/entities/booking-request'
import { REMINDER_LEAD_HOURS } from '@/domain/services/booking-reminder'
import type {
  BookingReminderStore,
  BookingRequestStore,
  BookingRetentionStore,
  CancelDinerBookingArgs,
  DecideBookingArgs,
  DinerBookingStore,
  HongKongMoment,
} from '@/domain/ports/booking'

const BOOKING_COLUMNS =
  'id, restaurant_id, member_id, phone, name, party_size, booking_date, booking_time, notes, status, decline_reason, decided_by, decided_at, source, campaign_id, created_at, decision_message_status'
/**
 * AGENT-003 (migration 085): the change/cancel columns, read only by the
 * dashboard list and the staff decision, so the BOOK-001 paths (booking page,
 * webhook) do not depend on 085's columns.
 */
const STAFF_COLUMNS =
  'id, restaurant_id, member_id, phone, name, party_size, booking_date, booking_time, notes, status, decline_reason, decided_by, decided_at, source, campaign_id, created_at, decision_message_status, replaces_booking_id, cancelled_by'

/** PostgREST `max_rows` (supabase/config.toml; the hosted default): no read returns more, whatever `limit` asks. */
const POSTGREST_MAX_ROWS = 1000

/**
 * BOOK-004 R4 (review F1): a capped list reads one row past the cap to know it
 * was cut, so the cap must leave room for that row under `max_rows`; otherwise
 * PostgREST returns exactly `max_rows` and `truncated` is never true.
 */
function readCap(cap: number): number {
  return Math.min(cap, POSTGREST_MAX_ROWS - 1)
}

function cappedList(rows: BookingRow[], cap: number): { bookings: BookingRequest[]; truncated: boolean } {
  return { bookings: rows.slice(0, cap).map(toBookingRequest), truncated: rows.length > cap }
}

interface BookingRow {
  id: string
  restaurant_id: string
  member_id: string | null
  phone: string
  name: string | null
  party_size: number
  booking_date: string
  booking_time: string
  notes: string | null
  status: BookingRequest['status']
  decline_reason: string | null
  decided_by: string | null
  decided_at: string | null
  source: BookingRequest['source']
  campaign_id: string | null
  created_at: string
  decision_message_status: DecisionMessageStatus | null
  replaces_booking_id?: string | null
  cancelled_by?: BookingCancelledBy | null
}

export function toBookingRequest(row: BookingRow): BookingRequest {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    memberId: row.member_id,
    phone: row.phone,
    name: row.name,
    partySize: row.party_size,
    bookingDate: row.booking_date,
    bookingTime: row.booking_time.slice(0, 5),
    notes: row.notes,
    status: row.status,
    declineReason: row.decline_reason,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    source: row.source,
    campaignId: row.campaign_id,
    createdAt: row.created_at,
    decisionMessageStatus: row.decision_message_status ?? null,
    ...(row.replaces_booking_id !== undefined ? { replacesBookingId: row.replaces_booking_id } : {}),
    ...(row.cancelled_by !== undefined ? { cancelledBy: row.cancelled_by } : {}),
  }
}

export async function insertBookingRequest(request: NewBookingRequest): Promise<BookingRequest> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('booking_requests')
    .insert({
      restaurant_id: request.restaurantId,
      member_id: request.memberId,
      phone: request.phone,
      name: request.name,
      party_size: request.partySize,
      booking_date: request.bookingDate,
      booking_time: request.bookingTime,
      notes: request.notes,
      source: request.source,
      campaign_id: request.campaignId,
      token: request.token,
      ...(request.replacesBookingId ? { replaces_booking_id: request.replacesBookingId } : {}),
    })
    .select(BOOKING_COLUMNS)
    .single()
  if (error || !data) throw new Error(`insertBookingRequest: ${error?.message ?? 'no row'}`)
  return toBookingRequest(data as BookingRow)
}

export async function countPendingBookings(restaurantId: string, phone: string): Promise<number> {
  const supabase = createServerSupabaseClient()
  const { count, error } = await supabase
    .from('booking_requests')
    .select('id', { count: 'exact', head: true })
    .eq('restaurant_id', restaurantId)
    .eq('phone', phone)
    .eq('status', 'pending')
  if (error) throw new Error(`countPendingBookings: ${error.message}`)
  return count ?? 0
}

/**
 * F10 (review #8): every pending request (they need action; R11 caps each
 * phone at 3) plus the newest `decidedLimit` decided ones, newest first. Both
 * reads use booking_requests_restaurant_status_created_idx.
 */
export async function listBookingRequests(restaurantId: string, decidedLimit: number): Promise<BookingRequest[]> {
  const supabase = createServerSupabaseClient()
  const [pending, decided] = await Promise.all([
    supabase
      .from('booking_requests')
      .select(STAFF_COLUMNS)
      .eq('restaurant_id', restaurantId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),
    supabase
      .from('booking_requests')
      .select(STAFF_COLUMNS)
      .eq('restaurant_id', restaurantId)
      .in('status', ['confirmed', 'declined', 'cancelled'])
      .order('created_at', { ascending: false })
      .limit(decidedLimit),
  ])
  const error = pending.error ?? decided.error
  if (error) throw new Error(`listBookingRequests: ${error.message}`)
  const rows = [...((pending.data ?? []) as BookingRow[]), ...((decided.data ?? []) as BookingRow[])]
  const bookings = rows.sort((a, b) => b.created_at.localeCompare(a.created_at)).map(toBookingRequest)
  return withReplacedSlots(restaurantId, bookings)
}

/** AGENT-003 R23: the slot each change request would replace (old → new in 訂座), one scoped read. */
async function withReplacedSlots(restaurantId: string, bookings: BookingRequest[]): Promise<BookingRequest[]> {
  const ids = [...new Set(bookings.map((b) => b.replacesBookingId).filter((id): id is string => !!id))]
  if (ids.length === 0) return bookings
  const { data, error } = await createServerSupabaseClient()
    .from('booking_requests')
    .select('id, booking_date, booking_time, party_size')
    .eq('restaurant_id', restaurantId)
    .in('id', ids)
  if (error) throw new Error(`listBookingRequests replaced: ${error.message}`)
  const slots = new Map(
    ((data ?? []) as Array<{ id: string; booking_date: string; booking_time: string; party_size: number }>).map((r) => [
      r.id,
      { bookingDate: r.booking_date, bookingTime: r.booking_time.slice(0, 5), partySize: r.party_size },
    ])
  )
  return bookings.map((b) => (b.replacesBookingId ? { ...b, replaces: slots.get(b.replacesBookingId) ?? null } : b))
}

type CappedList = { bookings: BookingRequest[]; truncated: boolean }

/** BOOK-004 r4: the AGENT-003 replaced slots (old → new) on a capped list too. */
async function withReplacedSlotsIn(restaurantId: string, list: CappedList): Promise<CappedList> {
  return { ...list, bookings: await withReplacedSlots(restaurantId, list.bookings) }
}

/**
 * BOOK-004: one restaurant's staff-visible bookings dated within `range`
 * (inclusive), by date then time. R1 tenant scope and R2 the unverified
 * exclusion are filters of the query itself (an allow-list, so a status added
 * later stays hidden until the views handle it; r4: cancelled is shown, like
 * declined, owner 2026-11-19); R4 reads one row past `cap` to know whether the
 * list was cut (under `max_rows`: `readCap`). AGENT-003 columns + replaced slots.
 */
export async function listBookingRequestsInRange(
  restaurantId: string,
  range: BookingDateRange,
  cap: number
): Promise<{ bookings: BookingRequest[]; truncated: boolean }> {
  const keep = readCap(cap)
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('booking_requests')
    .select(STAFF_COLUMNS)
    .eq('restaurant_id', restaurantId)
    .in('status', ['pending', 'confirmed', 'declined', 'cancelled'])
    .gte('booking_date', range.from)
    .lte('booking_date', range.to)
    .order('booking_date', { ascending: true })
    .order('booking_time', { ascending: true })
    .limit(keep + 1)
  if (error) throw new Error(`listBookingRequestsInRange: ${error.message}`)
  return withReplacedSlotsIn(restaurantId, cappedList((data ?? []) as BookingRow[], keep))
}

/**
 * BOOK-004 r2: every pending request of one restaurant, any date (past-dated
 * included), by date then time: the list behind the "need a reply" count, so
 * it holds the same rows as `countRestaurantPendingBookings`. Tenant and
 * status are filters of the query (R1, R2); reads one past `cap` (R4, `readCap`).
 */
export async function listPendingBookingRequests(
  restaurantId: string,
  cap: number
): Promise<{ bookings: BookingRequest[]; truncated: boolean }> {
  const keep = readCap(cap)
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('booking_requests')
    .select(STAFF_COLUMNS)
    .eq('restaurant_id', restaurantId)
    .eq('status', 'pending')
    .order('booking_date', { ascending: true })
    .order('booking_time', { ascending: true })
    .limit(keep + 1)
  if (error) throw new Error(`listPendingBookingRequests: ${error.message}`)
  return withReplacedSlotsIn(restaurantId, cappedList((data ?? []) as BookingRow[], keep))
}

/** BOOK-004: every pending request of one restaurant, any date (the "need a reply" count). */
export async function countRestaurantPendingBookings(restaurantId: string): Promise<number> {
  const supabase = createServerSupabaseClient()
  const { count, error } = await supabase
    .from('booking_requests')
    .select('id', { count: 'exact', head: true })
    .eq('restaurant_id', restaurantId)
    .eq('status', 'pending')
  if (error) throw new Error(`countRestaurantPendingBookings: ${error.message}`)
  return count ?? 0
}

export async function findBookingForRestaurant(id: string, restaurantId: string): Promise<BookingRequest | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('booking_requests')
    .select(BOOKING_COLUMNS)
    .eq('id', id)
    .eq('restaurant_id', restaurantId)
    // BOOK-003 (R41): an unconfirmed agent booking does not exist for staff.
    .neq('status', 'unverified')
    .maybeSingle()
  if (error) throw new Error(`findBookingForRestaurant: ${error.message}`)
  return data ? toBookingRequest(data as BookingRow) : null
}

export async function decideBookingRequest(args: DecideBookingArgs): Promise<BookingRequest | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('booking_requests')
    .update({
      status: args.decision,
      decided_by: args.decidedBy,
      decided_at: args.decidedAt.toISOString(),
      decline_reason: args.decision === 'declined' ? args.declineReason : null,
    })
    .eq('id', args.id)
    .eq('restaurant_id', args.restaurantId)
    .eq('status', 'pending')
    .select(STAFF_COLUMNS)
    .maybeSingle()
  if (error) throw new Error(`decideBookingRequest: ${error.message}`)
  return data ? toBookingRequest(data as BookingRow) : null
}

/** AGENT-003 R23: confirm a change request and cancel what it replaces, atomically (migration 085). */
export async function confirmBookingChange(
  args: Omit<DecideBookingArgs, 'decision' | 'declineReason'>
): Promise<BookingRequest | null> {
  const { data, error } = await createServerSupabaseClient()
    .rpc('confirm_booking_change', {
      p_id: args.id,
      p_restaurant_id: args.restaurantId,
      p_decided_by: args.decidedBy,
      p_decided_at: args.decidedAt.toISOString(),
    })
    .select(STAFF_COLUMNS)
  if (error) throw new Error(`confirmBookingChange: ${error.message}`)
  const row = ((data ?? []) as BookingRow[])[0]
  return row ? toBookingRequest(row) : null
}

/** F9 (review #7): store the decision message outcome so the badge survives a reload. */
export async function recordDecisionMessage(id: string, restaurantId: string, status: DecisionMessageStatus): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase
    .from('booking_requests')
    .update({ decision_message_status: status })
    .eq('id', id)
    .eq('restaurant_id', restaurantId)
  if (error) throw new Error(`recordDecisionMessage: ${error.message}`)
}

/**
 * W3 (AC-15): confirmed bookings whose reminder is due at `now`, across
 * restaurants (cron only). F7: the start window and the booked-3h-ahead rule
 * run in SQL (booking_reminder_candidates, migration 082), earliest start
 * first, so the limit never drops a due booking behind never-due ones.
 */
export async function listReminderCandidates(now: Date, limit: number): Promise<BookingRequest[]> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .rpc('booking_reminder_candidates', { p_now: now.toISOString(), p_lead_hours: REMINDER_LEAD_HOURS, p_limit: limit })
    .select(BOOKING_COLUMNS)
  if (error) throw new Error(`listReminderCandidates: ${error.message}`)
  return ((data ?? []) as BookingRow[]).map(toBookingRequest)
}

/** W3: the reminder claim. One conditional UPDATE, so one caller wins. */
export async function claimBookingReminder(id: string, at: Date): Promise<boolean> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('booking_requests')
    .update({ reminder_sent_at: at.toISOString() })
    .eq('id', id)
    .eq('status', 'confirmed')
    .is('reminder_sent_at', null)
    .select('id')
  if (error) throw new Error(`claimBookingReminder: ${error.message}`)
  return (data ?? []).length === 1
}

/** W3 (R19): clear name and notes on bookings dated before `beforeDate`, once. */
export async function purgeBookingPii(beforeDate: string, at: Date): Promise<number> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('booking_requests')
    .update({ name: null, notes: null, pii_purged_at: at.toISOString() })
    .lt('booking_date', beforeDate)
    .is('pii_purged_at', null)
    .select('id')
  if (error) throw new Error(`purgeBookingPii: ${error.message}`)
  return (data ?? []).length
}

const DINER_COLUMNS = 'id, booking_date, booking_time, party_size, status, name, notes, member_id, replaces_booking_id'

/**
 * AGENT-003 R20/R24 (review F10): a later date, or today at the Hong Kong
 * time now or later, as one PostgREST logic tree. `from` is built by the app
 * (YYYY-MM-DD, HH:MM), never from model input.
 */
export function upcomingFilter(from: HongKongMoment): string {
  return `booking_date.gt.${from.date},and(booking_date.eq.${from.date},booking_time.gte.${from.time})`
}

/** AGENT-003 R20: scoped by restaurant AND phone in the WHERE; upcoming only. */
export async function listUpcomingDinerBookings(restaurantId: string, phone: string, from: HongKongMoment): Promise<DinerBooking[]> {
  const { data, error } = await createServerSupabaseClient()
    .from('booking_requests')
    .select(DINER_COLUMNS)
    .eq('restaurant_id', restaurantId)
    .eq('phone', phone)
    .in('status', ['pending', 'confirmed'])
    .or(upcomingFilter(from))
    .order('booking_date', { ascending: true })
    .order('booking_time', { ascending: true })
    .limit(20)
  if (error) throw new Error(`listUpcomingDinerBookings: ${error.message}`)
  return (
    (data ?? []) as Array<{
      id: string
      booking_date: string
      booking_time: string
      party_size: number
      status: 'pending' | 'confirmed'
      name: string | null
      notes: string | null
      member_id: string | null
      replaces_booking_id: string | null
    }>
  ).map((r) => ({
    id: r.id,
    bookingDate: r.booking_date,
    bookingTime: r.booking_time.slice(0, 5),
    partySize: r.party_size,
    status: r.status,
    name: r.name,
    notes: r.notes,
    memberId: r.member_id,
    replacesBookingId: r.replaces_booking_id,
  }))
}

/**
 * AGENT-003 R24 (re-review N2): the booking while upcoming, or its open change
 * request whatever its date, so a past same-day change request is not left
 * pending (and confirmable) after its original is cancelled.
 */
export function dinerCancelFilter(id: string, from: HongKongMoment): string {
  return `and(id.eq.${id},or(${upcomingFilter(from)})),and(replaces_booking_id.eq.${id},status.eq.pending)`
}

/**
 * AGENT-003 R24: one UPDATE, so the booking and its open change requests are
 * cancelled together. Scoped by restaurant, phone and open status; upcoming
 * applies to the booking itself (N2).
 */
export async function cancelDinerBooking(args: CancelDinerBookingArgs): Promise<string[]> {
  const at = args.at.toISOString()
  const { data, error } = await createServerSupabaseClient()
    .from('booking_requests')
    .update({ status: 'cancelled', cancelled_by: 'diner_ai', cancelled_at: at })
    .eq('restaurant_id', args.restaurantId)
    .eq('phone', args.phone)
    .in('status', ['pending', 'confirmed'])
    .or(dinerCancelFilter(args.id, args.from))
    .select('id')
  if (error) throw new Error(`cancelDinerBooking: ${error.message}`)
  return ((data ?? []) as Array<{ id: string }>).map((r) => r.id)
}

export const dinerBookingStore: DinerBookingStore = {
  listUpcoming: listUpcomingDinerBookings,
  cancelByDiner: cancelDinerBooking,
}

export const bookingCronStore: BookingReminderStore & BookingRetentionStore = {
  listReminderCandidates,
  claimReminder: claimBookingReminder,
  purgePii: purgeBookingPii,
}

export const bookingRequestStore: BookingRequestStore = {
  insert: insertBookingRequest,
  countPending: countPendingBookings,
  listForRestaurant: listBookingRequests,
  findForRestaurant: findBookingForRestaurant,
  decide: decideBookingRequest,
  confirmChange: confirmBookingChange,
  recordDecisionMessage,
}

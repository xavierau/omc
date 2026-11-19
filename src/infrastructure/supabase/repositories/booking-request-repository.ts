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
  BookingDateRange,
  BookingRequest,
  DecisionMessageStatus,
  NewBookingRequest,
} from '@/domain/entities/booking-request'
import { REMINDER_LEAD_HOURS } from '@/domain/services/booking-reminder'
import type {
  BookingReminderStore,
  BookingRequestStore,
  BookingRetentionStore,
  DecideBookingArgs,
} from '@/domain/ports/booking'

const BOOKING_COLUMNS =
  'id, restaurant_id, member_id, phone, name, party_size, booking_date, booking_time, notes, status, decline_reason, decided_by, decided_at, source, campaign_id, created_at, decision_message_status'

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
      .select(BOOKING_COLUMNS)
      .eq('restaurant_id', restaurantId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),
    supabase
      .from('booking_requests')
      .select(BOOKING_COLUMNS)
      .eq('restaurant_id', restaurantId)
      .in('status', ['confirmed', 'declined'])
      .order('created_at', { ascending: false })
      .limit(decidedLimit),
  ])
  const error = pending.error ?? decided.error
  if (error) throw new Error(`listBookingRequests: ${error.message}`)
  const rows = [...((pending.data ?? []) as BookingRow[]), ...((decided.data ?? []) as BookingRow[])]
  return rows.sort((a, b) => b.created_at.localeCompare(a.created_at)).map(toBookingRequest)
}

/**
 * BOOK-004: one restaurant's staff-visible bookings dated within `range`
 * (inclusive), by date then time. R1 tenant scope and R2 the unverified
 * exclusion are filters of the query itself (an allow-list, so a status added
 * later stays hidden until the views handle it); R4 reads one row past `cap`
 * to know whether the list was cut (under `max_rows`: `readCap`).
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
    .select(BOOKING_COLUMNS)
    .eq('restaurant_id', restaurantId)
    .in('status', ['pending', 'confirmed', 'declined'])
    .gte('booking_date', range.from)
    .lte('booking_date', range.to)
    .order('booking_date', { ascending: true })
    .order('booking_time', { ascending: true })
    .limit(keep + 1)
  if (error) throw new Error(`listBookingRequestsInRange: ${error.message}`)
  return cappedList((data ?? []) as BookingRow[], keep)
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
    .select(BOOKING_COLUMNS)
    .eq('restaurant_id', restaurantId)
    .eq('status', 'pending')
    .order('booking_date', { ascending: true })
    .order('booking_time', { ascending: true })
    .limit(keep + 1)
  if (error) throw new Error(`listPendingBookingRequests: ${error.message}`)
  return cappedList((data ?? []) as BookingRow[], keep)
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
    .select(BOOKING_COLUMNS)
    .maybeSingle()
  if (error) throw new Error(`decideBookingRequest: ${error.message}`)
  return data ? toBookingRequest(data as BookingRow) : null
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
  recordDecisionMessage,
}

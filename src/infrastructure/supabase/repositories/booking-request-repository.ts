/**
 * BOOK-001: booking requests (`booking_requests`, migration 082).
 *
 * Every dashboard read and write is scoped by `restaurant_id` inside the
 * query itself (R6; memory: principle_authorize_by_scoped_query). A decision
 * is one conditional UPDATE on `status = 'pending'`, so two staff tapping at
 * once change the row once (R4) and the loser gets null.
 */
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import type { BookingRequest, NewBookingRequest } from '@/domain/entities/booking-request'
import type {
  BookingReminderStore,
  BookingRequestStore,
  BookingRetentionStore,
  DecideBookingArgs,
} from '@/domain/ports/booking'

const BOOKING_COLUMNS =
  'id, restaurant_id, member_id, phone, name, party_size, booking_date, booking_time, notes, status, decline_reason, decided_by, decided_at, source, campaign_id, created_at'

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

export async function listBookingRequests(restaurantId: string, limit: number): Promise<BookingRequest[]> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('booking_requests')
    .select(BOOKING_COLUMNS)
    .eq('restaurant_id', restaurantId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`listBookingRequests: ${error.message}`)
  return ((data ?? []) as BookingRow[]).map(toBookingRequest)
}

export async function findBookingForRestaurant(id: string, restaurantId: string): Promise<BookingRequest | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('booking_requests')
    .select(BOOKING_COLUMNS)
    .eq('id', id)
    .eq('restaurant_id', restaurantId)
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

/**
 * W3 (AC-15): confirmed bookings still owed a reminder on the given HK dates,
 * across restaurants (cron only; index booking_requests_reminder_due_idx).
 */
export async function listReminderCandidates(fromDate: string, toDate: string, limit: number): Promise<BookingRequest[]> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('booking_requests')
    .select(BOOKING_COLUMNS)
    .eq('status', 'confirmed')
    .is('reminder_sent_at', null)
    .gte('booking_date', fromDate)
    .lte('booking_date', toDate)
    .order('booking_date', { ascending: true })
    .limit(limit)
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
}

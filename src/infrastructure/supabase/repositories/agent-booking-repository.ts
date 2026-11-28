/**
 * BOOK-003: agent bookings (`booking_requests` rows with source 'agent',
 * migration 084) and the agent booking id directory.
 *
 * Every query is scoped by restaurant_id inside the query (memory:
 * principle_authorize_by_scoped_query). Promotion is ONE RPC
 * (promote_agent_booking, migration 084): a conditional UPDATE on status
 * 'unverified', the sender's phone, the code and an unexpired window, so a
 * replayed webhook or a code from another number changes nothing (R31, R32),
 * and limited in the same transaction to the room under the phone's pending
 * cap (BOOK-001 R11, review F1). The confirm code is cleared as the row is
 * promoted.
 */
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { resolveBookingConfig } from '@/domain/value-objects/booking-config'
import type { AgentBooking, NewAgentBooking } from '@/domain/entities/booking-request'
import type {
  AgentBookingDirectory,
  AgentBookingStore,
  InsertAgentBookingResult,
  PromoteAgentBookingArgs,
  UnverifiedBookingPurgeStore,
} from '@/domain/ports/booking'
import { countPendingBookings, toBookingRequest } from './booking-request-repository'

// BOOK-009: 091's terms columns, so the confirm reply can repeat the accepted text (spec AC-13).
const AGENT_BOOKING_COLUMNS =
  'id, restaurant_id, member_id, phone, name, party_size, booking_date, booking_time, notes, status, decline_reason, decided_by, decided_at, source, campaign_id, created_at, decision_message_status, confirm_code, verify_expires_at, verified_at, verified_wamid, status_token_hash, idempotency_key, terms_accepted_at, terms_text'

type BookingRow = Parameters<typeof toBookingRequest>[0]

interface AgentBookingRow extends BookingRow {
  /** 096: an agent row always has its phone (CHECK phone IS NOT NULL OR source = 'staff'). */
  phone: string
  confirm_code: string | null
  verify_expires_at: string | null
  verified_at: string | null
  verified_wamid: string | null
  status_token_hash: string | null
  idempotency_key: string | null
}

export function toAgentBooking(row: AgentBookingRow): AgentBooking {
  return {
    ...toBookingRequest(row),
    phone: row.phone,
    confirmCode: row.confirm_code,
    verifyExpiresAt: row.verify_expires_at,
    verifiedAt: row.verified_at,
    verifiedWamid: row.verified_wamid,
    statusTokenHash: row.status_token_hash,
    idempotencyKey: row.idempotency_key,
  }
}

const CONFLICTS = [
  ['booking_requests_restaurant_confirm_code_idx', 'confirm_code'],
  ['booking_requests_restaurant_idempotency_key_idx', 'idempotency_key'],
] as const

export async function insertAgentBooking(booking: NewAgentBooking): Promise<InsertAgentBookingResult> {
  const { data, error } = await createServerSupabaseClient()
    .from('booking_requests')
    .insert({
      restaurant_id: booking.restaurantId,
      member_id: null,
      phone: booking.phone,
      name: booking.name,
      party_size: booking.partySize,
      booking_date: booking.bookingDate,
      booking_time: booking.bookingTime,
      notes: booking.notes,
      status: 'unverified',
      source: 'agent',
      campaign_id: null,
      token: null,
      confirm_code: booking.confirmCode,
      verify_expires_at: booking.verifyExpiresAt,
      status_token_hash: booking.statusTokenHash,
      idempotency_key: booking.idempotencyKey,
      // BOOK-009: only a booking with accepted terms writes 091's columns.
      ...(booking.termsAcceptedAt ? { terms_accepted_at: booking.termsAcceptedAt, terms_text: booking.termsText } : {}),
    })
    .select(AGENT_BOOKING_COLUMNS)
    .single()
  if (error?.code === '23505') {
    const hit = CONFLICTS.find(([index]) => error.message.includes(index))
    if (hit) return { ok: false, conflict: hit[1] }
  }
  if (error || !data) throw new Error(`insertAgentBooking: ${error?.code ?? 'no row'}`)
  return { ok: true, booking: toAgentBooking(data as AgentBookingRow) }
}

export async function countLiveUnverified(restaurantId: string, now: Date, phone?: string): Promise<number> {
  let query = createServerSupabaseClient()
    .from('booking_requests')
    .select('id', { count: 'exact', head: true })
    .eq('restaurant_id', restaurantId)
    .eq('status', 'unverified')
    .gt('verify_expires_at', now.toISOString())
  if (phone !== undefined) query = query.eq('phone', phone)
  const { count, error } = await query
  if (error) throw new Error(`countLiveUnverified: ${error.code}`)
  return count ?? 0
}

export async function findAgentBookingByIdempotencyKey(restaurantId: string, key: string): Promise<AgentBooking | null> {
  const { data, error } = await createServerSupabaseClient()
    .from('booking_requests')
    .select(AGENT_BOOKING_COLUMNS)
    .eq('restaurant_id', restaurantId)
    .eq('idempotency_key', key)
    .maybeSingle()
  if (error) throw new Error(`findAgentBookingByIdempotencyKey: ${error.code}`)
  return data ? toAgentBooking(data as AgentBookingRow) : null
}

export async function findAgentBooking(id: string, restaurantId: string): Promise<AgentBooking | null> {
  const { data, error } = await createServerSupabaseClient()
    .from('booking_requests')
    .select(AGENT_BOOKING_COLUMNS)
    .eq('id', id)
    .eq('restaurant_id', restaurantId)
    .eq('source', 'agent')
    .maybeSingle()
  if (error) throw new Error(`findAgentBooking: ${error.code}`)
  return data ? toAgentBooking(data as AgentBookingRow) : null
}

export async function replaceAgentStatusToken(id: string, restaurantId: string, statusTokenHash: string): Promise<void> {
  const { error } = await createServerSupabaseClient()
    .from('booking_requests')
    .update({ status_token_hash: statusTokenHash })
    .eq('id', id)
    .eq('restaurant_id', restaurantId)
    .eq('source', 'agent')
  if (error) throw new Error(`replaceAgentStatusToken: ${error.code}`)
}

/**
 * BOOK-010 (spec AC-6): the same promotion with room. The candidates' slots
 * are read first (same filter as the function), so the app can compute each
 * one's period and limits; promote_agent_booking_with_room (092) then
 * re-selects them under the phone and date locks and decides. A candidate
 * that appears in between is checked against stops only (missing from the map).
 */
async function promoteWithRoom(args: PromoteAgentBookingArgs, room: NonNullable<PromoteAgentBookingArgs['room']>) {
  const supabase = createServerSupabaseClient()
  const { data: candidates, error: readError } = await supabase
    .from('booking_requests')
    .select('id, booking_date, booking_time')
    .eq('restaurant_id', args.restaurantId)
    .eq('phone', args.phone)
    .eq('status', 'unverified')
    .in('confirm_code', args.codes)
    .gt('verify_expires_at', args.at.toISOString())
  if (readError) throw new Error(`promoteAgentBooking candidates: ${readError.code}`)
  const rooms = Object.fromEntries(
    ((candidates ?? []) as Array<{ id: string; booking_date: string; booking_time: string }>).map((c) => {
      const check = room({ date: c.booking_date, time: c.booking_time.slice(0, 5) })
      return [c.id, {
        period_key: check.periodKey, period_first: check.periodFirst, period_last: check.periodLast,
        slot_limit: check.perSlot, meal_limit: check.perMeal,
      }]
    })
  )
  const { data, error } = await supabase
    .rpc('promote_agent_booking_with_room', {
      p_restaurant_id: args.restaurantId,
      p_phone: args.phone,
      p_codes: args.codes,
      p_wamid: args.wamid,
      p_at: args.at.toISOString(),
      p_max_pending: args.maxPending,
      p_rooms: rooms,
    })
    .select(AGENT_BOOKING_COLUMNS)
  if (error) throw new Error(`promoteAgentBooking: ${error.code}`)
  return ((data ?? []) as AgentBookingRow[]).map(toBookingRequest)
}

export async function promoteAgentBooking(args: PromoteAgentBookingArgs) {
  if (args.codes.length === 0) return []
  if (args.room) return promoteWithRoom(args, args.room)
  const { data, error } = await createServerSupabaseClient()
    .rpc('promote_agent_booking', {
      p_restaurant_id: args.restaurantId,
      p_phone: args.phone,
      p_codes: args.codes,
      p_wamid: args.wamid,
      p_at: args.at.toISOString(),
      p_max_pending: args.maxPending,
    })
    .select(AGENT_BOOKING_COLUMNS)
  if (error) throw new Error(`promoteAgentBooking: ${error.code}`)
  return ((data ?? []) as AgentBookingRow[]).map(toBookingRequest)
}

/**
 * BOOK-008 R1: link a promoted booking to an existing member (found by the
 * caller by phone in the same restaurant). Scoped by id AND restaurant, only
 * while member_id is still null and the row is past unverified.
 */
export async function linkAgentBookingMember(id: string, restaurantId: string, memberId: string): Promise<boolean> {
  const { data, error } = await createServerSupabaseClient()
    .from('booking_requests')
    .update({ member_id: memberId })
    .eq('id', id)
    .eq('restaurant_id', restaurantId)
    .is('member_id', null)
    .neq('status', 'unverified')
    .select('id')
  if (error) throw new Error(`linkAgentBookingMember: ${error.code}`)
  return (data ?? []).length === 1
}

/** R41: unverified rows created before `createdBefore` are deleted outright. */
export async function purgeUnverifiedBookings(createdBefore: Date): Promise<number> {
  const { data, error } = await createServerSupabaseClient()
    .from('booking_requests')
    .delete()
    .eq('status', 'unverified')
    .lt('created_at', createdBefore.toISOString())
    .select('id')
  if (error) throw new Error(`purgeUnverifiedBookings: ${error.code}`)
  return (data ?? []).length
}

/** R33: the restaurant whose booking_config.agentBooking.publicId is this id (unique index, 084). */
export async function findRestaurantByAgentPublicId(publicId: string) {
  const { data, error } = await createServerSupabaseClient()
    .from('restaurants')
    .select('id, booking_config')
    .eq('booking_config->agentBooking->>publicId', publicId)
    .maybeSingle()
  if (error) throw new Error(`findRestaurantByAgentPublicId: ${error.code}`)
  if (!data) return null
  const row = data as { id: string; booking_config: unknown }
  return { restaurantId: row.id, config: resolveBookingConfig(row.booking_config) }
}
/** BOOK-009 F1 (P2-2): the rows promote_agent_booking would match, read only. */
export async function findPromotableAgentBookings(args: Pick<PromoteAgentBookingArgs, 'restaurantId' | 'phone' | 'codes' | 'at'>) {
  if (args.codes.length === 0) return []
  const { data, error } = await createServerSupabaseClient()
    .from('booking_requests')
    .select(AGENT_BOOKING_COLUMNS)
    .eq('restaurant_id', args.restaurantId)
    .eq('phone', args.phone)
    .eq('status', 'unverified')
    .in('confirm_code', args.codes)
    .gt('verify_expires_at', args.at.toISOString())
  if (error) throw new Error(`findPromotableAgentBookings: ${error.code}`)
  return ((data ?? []) as AgentBookingRow[]).map(toAgentBooking)
}

/** BOOK-009 F1 (P2-2): refused at the confirm step by the booking rules; no staff decided it. */
export async function declineUnverifiedAgentBooking(id: string, restaurantId: string, at: Date, reason: string): Promise<boolean> {
  const { data, error } = await createServerSupabaseClient()
    .from('booking_requests')
    .update({ status: 'declined', decline_reason: reason, decided_at: at.toISOString(), confirm_code: null })
    .eq('id', id)
    .eq('restaurant_id', restaurantId)
    .eq('status', 'unverified')
    .select('id')
  if (error) throw new Error(`declineUnverifiedAgentBooking: ${error.code}`)
  return (data ?? []).length === 1
}

export const agentBookingStore: AgentBookingStore = {
  insert: insertAgentBooking,
  countLiveUnverified,
  countPending: countPendingBookings,
  findByIdempotencyKey: findAgentBookingByIdempotencyKey,
  find: findAgentBooking,
  replaceStatusToken: replaceAgentStatusToken,
  promote: promoteAgentBooking,
  findPromotable: findPromotableAgentBookings,
  declineUnverified: declineUnverifiedAgentBooking,
  linkMember: linkAgentBookingMember,
}

export const agentBookingDirectory: AgentBookingDirectory = { findByPublicId: findRestaurantByAgentPublicId }

export const unverifiedBookingPurgeStore: UnverifiedBookingPurgeStore = { purgeUnverified: purgeUnverifiedBookings }

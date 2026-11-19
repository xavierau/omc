/**
 * BOOK-003: agent bookings (`booking_requests` rows with source 'agent',
 * migration 083) and the agent booking id directory.
 *
 * Every query is scoped by restaurant_id inside the query (memory:
 * principle_authorize_by_scoped_query). Promotion is ONE conditional UPDATE
 * on status 'unverified', the sender's phone, the code and an unexpired
 * window, so a replayed webhook or a code from another number changes
 * nothing (R31, R32). The confirm code is cleared as the row is promoted.
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
import { toBookingRequest } from './booking-request-repository'

const AGENT_BOOKING_COLUMNS =
  'id, restaurant_id, member_id, phone, name, party_size, booking_date, booking_time, notes, status, decline_reason, decided_by, decided_at, source, campaign_id, created_at, decision_message_status, confirm_code, verify_expires_at, verified_at, verified_wamid, status_token_hash, idempotency_key'

type BookingRow = Parameters<typeof toBookingRequest>[0]

interface AgentBookingRow extends BookingRow {
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

export async function promoteAgentBooking(args: PromoteAgentBookingArgs) {
  if (args.codes.length === 0) return []
  const at = args.at.toISOString()
  const { data, error } = await createServerSupabaseClient()
    .from('booking_requests')
    .update({ status: 'pending', verified_at: at, verified_wamid: args.wamid, confirm_code: null })
    .eq('restaurant_id', args.restaurantId)
    .eq('phone', args.phone)
    .eq('status', 'unverified')
    .in('confirm_code', args.codes)
    .gt('verify_expires_at', at)
    .select(AGENT_BOOKING_COLUMNS)
  if (error) throw new Error(`promoteAgentBooking: ${error.code}`)
  return ((data ?? []) as AgentBookingRow[]).map(toBookingRequest)
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

/** R33: the restaurant whose booking_config.agentBooking.publicId is this id (unique index, 083). */
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

export const agentBookingStore: AgentBookingStore = {
  insert: insertAgentBooking,
  countLiveUnverified,
  findByIdempotencyKey: findAgentBookingByIdempotencyKey,
  find: findAgentBooking,
  replaceStatusToken: replaceAgentStatusToken,
  promote: promoteAgentBooking,
}

export const agentBookingDirectory: AgentBookingDirectory = { findByPublicId: findRestaurantByAgentPublicId }

export const unverifiedBookingPurgeStore: UnverifiedBookingPurgeStore = { purgeUnverified: purgeUnverifiedBookings }

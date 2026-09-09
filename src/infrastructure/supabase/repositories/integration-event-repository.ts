// INT-001 WI-6: reads/writes `integration_events` (migration 071). The
// fast path (`emit-integration-event.ts`) inserts `member.created`/`ping`
// rows here; `member.updated` rows are inserted directly by DB triggers on
// `members`/`consent_records`/`integration_member_refs` and never go
// through this file's insert function.

import { createServerSupabaseClient } from '../client'
import type { IntegrationEvent, IntegrationEventType } from '@/domain/entities/integration-event'

export interface InsertIntegrationEventArgs {
  id: string
  restaurantId: string
  memberId: string | null
  type: IntegrationEventType
  changed: string[]
  source: string | null
  originIntegrationId: string | null
  occurredAt: string
}

interface EventRow {
  id: string
  restaurant_id: string
  member_id: string | null
  type: IntegrationEventType
  changed: string[]
  source: string | null
  origin_integration_id: string | null
  occurred_at: string
}

function toEntity(row: EventRow): IntegrationEvent {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    memberId: row.member_id,
    type: row.type,
    changed: row.changed,
    originIntegrationId: row.origin_integration_id,
    occurredAt: row.occurred_at,
    source: row.source,
  }
}

/** Inserts one `integration_events` row. The migration-071 AFTER INSERT
 * trigger fans it out into `integration_deliveries` synchronously, in the
 * SAME transaction as this insert -- by the time this resolves, the
 * fanned-out rows already exist and are safe to query. */
export async function insertIntegrationEvent(args: InsertIntegrationEventArgs): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase.from('integration_events').insert({
    id: args.id,
    restaurant_id: args.restaurantId,
    member_id: args.memberId,
    type: args.type,
    changed: args.changed,
    source: args.source,
    origin_integration_id: args.originIntegrationId,
    occurred_at: args.occurredAt,
  })
  if (error) throw new Error(`insertIntegrationEvent: ${error.message}`)
}

export async function findIntegrationEventById(id: string): Promise<IntegrationEvent | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('integration_events')
    .select('id, restaurant_id, member_id, type, changed, source, origin_integration_id, occurred_at')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`findIntegrationEventById: ${error.message}`)
  return data ? toEntity(data as EventRow) : null
}

/**
 * WI-6 `build-outbound-payload.ts` fallback for `member.updated` events,
 * whose `source` column is always null (a SQL trigger has no notion of "how
 * the member originally joined" -- see integration-event.ts's `source` doc
 * comment). Looks up the SAME member's own `member.created` event, which
 * DOES carry it (set by the seam at emit time). Returns null when no such
 * event exists (a member created before this feature shipped) -- the
 * caller is responsible for a documented fallback in that case.
 */
export async function findEarliestMemberCreatedSource(memberId: string): Promise<string | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('integration_events')
    .select('source')
    .eq('member_id', memberId)
    .eq('type', 'member.created')
    .order('occurred_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`findEarliestMemberCreatedSource: ${error.message}`)
  return (data as { source: string | null } | null)?.source ?? null
}

/**
 * WI-6 sweeper (5-min maintenance): deletes `integration_events` rows older
 * than `olderThanDays` that have NO `integration_deliveries` row at all --
 * i.e. events nobody was ever going to receive (no integration was
 * subscribed at fan-out time). Two-phase (candidate ids, then which of them
 * have a delivery) rather than a single query: the Supabase JS client has
 * no NOT-EXISTS-subquery builder, and this table's volume doesn't justify a
 * new RPC function outside WI-6's migration boundary.
 */
export async function pruneOrphanIntegrationEvents(olderThanDays: number): Promise<number> {
  const supabase = createServerSupabaseClient()
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString()

  const { data: candidates, error: candidatesError } = await supabase
    .from('integration_events')
    .select('id')
    .lt('created_at', cutoff)
  if (candidatesError) throw new Error(`pruneOrphanIntegrationEvents (candidates): ${candidatesError.message}`)
  const candidateIds = ((candidates ?? []) as Array<{ id: string }>).map((row) => row.id)
  if (candidateIds.length === 0) return 0

  const { data: withDeliveries, error: deliveriesError } = await supabase
    .from('integration_deliveries')
    .select('event_id')
    .in('event_id', candidateIds)
  if (deliveriesError) throw new Error(`pruneOrphanIntegrationEvents (deliveries): ${deliveriesError.message}`)
  const idsWithDeliveries = new Set(
    ((withDeliveries ?? []) as Array<{ event_id: string }>).map((row) => row.event_id)
  )
  const orphanIds = candidateIds.filter((id) => !idsWithDeliveries.has(id))
  if (orphanIds.length === 0) return 0

  const { error: deleteError } = await supabase.from('integration_events').delete().in('id', orphanIds)
  if (deleteError) throw new Error(`pruneOrphanIntegrationEvents (delete): ${deleteError.message}`)
  return orphanIds.length
}

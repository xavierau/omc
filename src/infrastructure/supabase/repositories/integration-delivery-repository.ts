// INT-001 WI-6: reads/writes `integration_deliveries` (migration 071). The
// row's `status` transitions are enforced by the `IntegrationDelivery`
// entity (WI-1) -- every write here persists a snapshot the caller already
// produced via `.transitionTo(...)`, never a raw status string.

import { createServerSupabaseClient } from '../client'
import {
  IntegrationDelivery,
  type IntegrationDeliveryProps,
  type IntegrationDeliveryStatus,
} from '@/domain/entities/integration-delivery'

interface DeliveryRow {
  id: string
  integration_id: string
  restaurant_id: string
  event_id: string
  status: IntegrationDeliveryStatus
  attempts: number
  last_http_status: number | null
  last_error_code: string | null
  last_latency_ms: number | null
  response_excerpt: string | null
  next_retry_at: string | null
  enqueued_at: string | null
  delivered_at: string | null
  dead_lettered_at: string | null
  retried_at: string | null
}

const SELECT_COLUMNS =
  'id, integration_id, restaurant_id, event_id, status, attempts, last_http_status, last_error_code, last_latency_ms, response_excerpt, next_retry_at, enqueued_at, delivered_at, dead_lettered_at, retried_at'

function toEntity(row: DeliveryRow): IntegrationDelivery {
  const props: IntegrationDeliveryProps = {
    id: row.id,
    integrationId: row.integration_id,
    restaurantId: row.restaurant_id,
    eventId: row.event_id,
    status: row.status,
    attempts: row.attempts,
    lastHttpStatus: row.last_http_status,
    lastErrorCode: row.last_error_code,
    lastLatencyMs: row.last_latency_ms,
    responseExcerpt: row.response_excerpt,
    nextRetryAt: row.next_retry_at,
    enqueuedAt: row.enqueued_at,
    deliveredAt: row.delivered_at,
    deadLetteredAt: row.dead_lettered_at,
    retriedAt: row.retried_at,
  }
  return IntegrationDelivery.fromProps(props)
}

export async function findDeliveryById(id: string): Promise<IntegrationDelivery | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('integration_deliveries')
    .select(SELECT_COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`findDeliveryById: ${error.message}`)
  return data ? toEntity(data as DeliveryRow) : null
}

/** WI-14 (G-5, grok review, SEC-001/#111 pattern): the tenant-facing
 * dashboard retry path's own lookup -- scoped by BOTH `integrationId` AND
 * `restaurantId` IN THE QUERY, not fetch-then-compare in application code.
 * A foreign-tenant or foreign-integration delivery id resolves to `null`
 * here, identically to an unknown id, without the service-role read ever
 * materialising another tenant's row. `findDeliveryById` (unscoped) stays
 * as-is for the outbound worker's own internal paths, which have no
 * per-request tenant to scope by. */
export async function findDeliveryByIdForIntegration(
  id: string,
  integrationId: string,
  restaurantId: string
): Promise<IntegrationDelivery | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('integration_deliveries')
    .select(SELECT_COLUMNS)
    .eq('id', id)
    .eq('integration_id', integrationId)
    .eq('restaurant_id', restaurantId)
    .maybeSingle()
  if (error) throw new Error(`findDeliveryByIdForIntegration: ${error.message}`)
  return data ? toEntity(data as DeliveryRow) : null
}

/** Persists every mutable field of `delivery`'s current snapshot. The id
 * (and its immutable integration/restaurant/event linkage) is the WHERE
 * key, never written. */
export async function saveDelivery(delivery: IntegrationDelivery): Promise<void> {
  const s = delivery.snapshot
  const supabase = createServerSupabaseClient()
  const { error } = await supabase
    .from('integration_deliveries')
    .update({
      status: s.status,
      attempts: s.attempts,
      last_http_status: s.lastHttpStatus,
      last_error_code: s.lastErrorCode,
      last_latency_ms: s.lastLatencyMs,
      response_excerpt: s.responseExcerpt,
      next_retry_at: s.nextRetryAt,
      enqueued_at: s.enqueuedAt,
      delivered_at: s.deliveredAt,
      dead_lettered_at: s.deadLetteredAt,
      retried_at: s.retriedAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', s.id)
    // G-5 (WI-14, grok review, SEC-001/#111 pattern): restaurant_id is
    // immutable on this entity (never part of any `.transitionTo(...)`
    // patch), so adding it to the WHERE clause changes nothing for a
    // correctly-scoped caller -- it only stops a write whose snapshot
    // restaurantId doesn't match the row it thinks it's updating, which
    // can only happen if a future caller obtained the entity through a
    // path that skipped tenant scoping. Defense in depth alongside the
    // scoped READ (findDeliveryByIdForIntegration).
    .eq('restaurant_id', s.restaurantId)
  if (error) throw new Error(`saveDelivery: ${error.message}`)
}

/** Fast-path lookup (`emit-integration-event.ts`): the delivery rows the
 * migration-071 trigger JUST fanned out for one event, still `queued` and
 * never enqueued. No age threshold -- unlike the relay, this runs
 * synchronously right after the insert that created them. */
export async function findQueuedUnenqueuedDeliveriesForEvent(
  eventId: string
): Promise<IntegrationDelivery[]> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('integration_deliveries')
    .select(SELECT_COLUMNS)
    .eq('event_id', eventId)
    .eq('status', 'queued')
    .is('enqueued_at', null)
  if (error) throw new Error(`findQueuedUnenqueuedDeliveriesForEvent: ${error.message}`)
  return ((data ?? []) as DeliveryRow[]).map(toEntity)
}

/** WI-6 `send-test-event.ts`: every delivery row fanned out for one event,
 * regardless of status/enqueued_at -- unlike
 * `findQueuedUnenqueuedDeliveriesForEvent`, needed AFTER
 * `emitIntegrationEvent` has already run its fast path (which would have
 * cleared `enqueued_at`, making the other lookup return nothing). */
export async function findDeliveriesByEventId(eventId: string): Promise<IntegrationDelivery[]> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase.from('integration_deliveries').select(SELECT_COLUMNS).eq('event_id', eventId)
  if (error) throw new Error(`findDeliveriesByEventId: ${error.message}`)
  return ((data ?? []) as DeliveryRow[]).map(toEntity)
}

/** The 30s relay's own selection: exactly the set the fast path missed
 * (`principle_backstop_only_repairs_what_it_selects`) -- `queued AND
 * enqueued_at IS NULL`, aged past `olderThanMs` so it never races an
 * in-flight fast-path enqueue for the same row. */
export async function findDeliveriesToRelay(args: {
  olderThanMs: number
  limit: number
}): Promise<IntegrationDelivery[]> {
  const supabase = createServerSupabaseClient()
  const cutoff = new Date(Date.now() - args.olderThanMs).toISOString()
  const { data, error } = await supabase
    .from('integration_deliveries')
    .select(SELECT_COLUMNS)
    .eq('status', 'queued')
    .is('enqueued_at', null)
    .lt('created_at', cutoff)
    .limit(args.limit)
  if (error) throw new Error(`findDeliveriesToRelay: ${error.message}`)
  return ((data ?? []) as DeliveryRow[]).map(toEntity)
}

/** Idempotency guard for the relay (WI-6 Tests-first: "double run -> no
 * duplicate jobs"): the `WHERE enqueued_at IS NULL` makes a second stamp of
 * the same row a no-op rather than clobbering a concurrently-set
 * timestamp. The real dedup is BullMQ's own `jobId = deliveryId` (a second
 * `queue.add` with the same jobId is a no-op) -- this stamp only stops the
 * relay from re-selecting (and re-attempting `queue.add` for) the same row
 * on its very next tick. */
export async function markEnqueued(id: string, atIso: string): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase
    .from('integration_deliveries')
    .update({ enqueued_at: atIso })
    .eq('id', id)
    .is('enqueued_at', null)
  if (error) throw new Error(`markEnqueued: ${error.message}`)
}

/** Resume (US-9): every `paused` row for the integration, oldest first, up
 * to `limit` (the plan's `inbound_queue_cap` reuse -- see
 * `resume-outbound.ts`). Rows beyond the cap are the caller's job to
 * dead-letter directly, not re-queue. */
export async function findPausedDeliveriesForIntegration(
  integrationId: string,
  limit: number
): Promise<IntegrationDelivery[]> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('integration_deliveries')
    .select(SELECT_COLUMNS)
    .eq('integration_id', integrationId)
    .eq('status', 'paused')
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(`findPausedDeliveriesForIntegration: ${error.message}`)
  return ((data ?? []) as DeliveryRow[]).map(toEntity)
}

/** ALL `paused` rows for the integration, oldest first, uncapped -- used by
 * `resume-outbound.ts` to know which rows fall beyond the requeue cap (and
 * so must be dead-lettered directly instead). */
export async function findAllPausedDeliveryIdsForIntegration(integrationId: string): Promise<string[]> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('integration_deliveries')
    .select('id')
    .eq('integration_id', integrationId)
    .eq('status', 'paused')
    .order('created_at', { ascending: true })
  if (error) throw new Error(`findAllPausedDeliveryIdsForIntegration: ${error.message}`)
  return ((data ?? []) as Array<{ id: string }>).map((row) => row.id)
}

/** Distinct integration ids that have at least one delivery row -- the
 * maintenance sweep iterates this to prune per integration (the retention
 * rule is per-integration, not global). */
export async function listIntegrationIdsWithDeliveries(): Promise<string[]> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase.from('integration_deliveries').select('integration_id')
  if (error) throw new Error(`listIntegrationIdsWithDeliveries: ${error.message}`)
  const ids = new Set(((data ?? []) as Array<{ integration_id: string }>).map((row) => row.integration_id))
  return [...ids]
}

/** WI-8 `list-integration-deliveries.ts` (US-9 delivery log). Cursor is the
 * `created_at` of the last row on the previous page (exclusive `<`) --
 * `created_at` is deliberately NOT part of `SELECT_COLUMNS` /
 * `IntegrationDeliveryProps` (it's a read-projection-only field, not part
 * of the state machine), so this returns a dedicated row shape rather than
 * routing through `toEntity`. No N+1: the caller batches `eventId`s from
 * the returned rows into ONE `integration_events` query
 * (`findIntegrationEventsByIds`), never one lookup per row. */
export interface DeliveryListRow {
  id: string
  eventId: string
  status: IntegrationDeliveryStatus
  attempts: number
  lastHttpStatus: number | null
  lastErrorCode: string | null
  nextRetryAt: string | null
  createdAt: string
}

export interface FindDeliveriesForIntegrationArgs {
  status?: IntegrationDeliveryStatus
  cursor?: string
  limit: number
}

export async function findDeliveriesForIntegration(
  integrationId: string,
  restaurantId: string,
  args: FindDeliveriesForIntegrationArgs
): Promise<DeliveryListRow[]> {
  const supabase = createServerSupabaseClient()
  let query = supabase
    .from('integration_deliveries')
    .select('id, event_id, status, attempts, last_http_status, last_error_code, next_retry_at, created_at')
    .eq('integration_id', integrationId)
    .eq('restaurant_id', restaurantId)
    .order('created_at', { ascending: false })
    .limit(args.limit)

  if (args.status) query = query.eq('status', args.status)
  if (args.cursor) query = query.lt('created_at', args.cursor)

  const { data, error } = await query
  if (error) throw new Error(`findDeliveriesForIntegration: ${error.message}`)

  return (
    (data ?? []) as Array<{
      id: string
      event_id: string
      status: IntegrationDeliveryStatus
      attempts: number
      last_http_status: number | null
      last_error_code: string | null
      next_retry_at: string | null
      created_at: string
    }>
  ).map((row) => ({
    id: row.id,
    eventId: row.event_id,
    status: row.status,
    attempts: row.attempts,
    lastHttpStatus: row.last_http_status,
    lastErrorCode: row.last_error_code,
    nextRetryAt: row.next_retry_at,
    createdAt: row.created_at,
  }))
}

/** Delivery-log pruning (US-9, spec: "last 30 days or 500 rows, whichever
 * smaller"): deletes rows older than `olderThanDays` OR beyond the newest
 * `keepNewest` for this integration, whichever criterion catches them
 * first. Two passes (age, then cap) rather than one query -- the Supabase
 * JS client has no OFFSET-after-DELETE primitive. */
export async function pruneDeliveriesForIntegration(
  integrationId: string,
  keepNewest: number,
  olderThanDays: number
): Promise<number> {
  const supabase = createServerSupabaseClient()
  let deleted = 0

  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString()
  const { data: oldRows, error: oldErr } = await supabase
    .from('integration_deliveries')
    .select('id')
    .eq('integration_id', integrationId)
    .lt('created_at', cutoff)
  if (oldErr) throw new Error(`pruneDeliveriesForIntegration (age): ${oldErr.message}`)
  const oldIds = ((oldRows ?? []) as Array<{ id: string }>).map((row) => row.id)
  if (oldIds.length > 0) {
    const { error } = await supabase.from('integration_deliveries').delete().in('id', oldIds)
    if (error) throw new Error(`pruneDeliveriesForIntegration (age delete): ${error.message}`)
    deleted += oldIds.length
  }

  const { data: remaining, error: remErr } = await supabase
    .from('integration_deliveries')
    .select('id')
    .eq('integration_id', integrationId)
    .order('created_at', { ascending: false })
  if (remErr) throw new Error(`pruneDeliveriesForIntegration (remaining): ${remErr.message}`)
  const remainingIds = ((remaining ?? []) as Array<{ id: string }>).map((row) => row.id)
  const beyondCapIds = remainingIds.slice(keepNewest)
  if (beyondCapIds.length > 0) {
    const { error } = await supabase.from('integration_deliveries').delete().in('id', beyondCapIds)
    if (error) throw new Error(`pruneDeliveriesForIntegration (cap delete): ${error.message}`)
    deleted += beyondCapIds.length
  }
  return deleted
}

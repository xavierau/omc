// INVARIANT (WAQ-006): the SOLE writer to the `tenant_quality_state` table.
// `createServerSupabaseClient()` uses SUPABASE_SERVICE_ROLE_KEY which bypasses
// RLS — there are no INSERT/UPDATE policies on the table by design. Do NOT
// add a browser-side write path; route every mutation through the named
// functions below so callers stay observable. Mirrors the same posture as
// `whatsapp-message-repository.ts`.

import { createServerSupabaseClient } from '../client'
import { QualityStateEvent } from '@/domain/entities/quality-state-event'
import type {
  FindLatestArgs,
  QualityStateRepository,
} from '@/domain/repositories/quality-state-repository'
import {
  toEntity,
  toInsertRow,
  type TenantQualityStateRow,
} from './quality-state-mapper'

const TABLE = 'tenant_quality_state'

export async function insertEvent(event: QualityStateEvent): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase.from(TABLE).insert(toInsertRow(event))
  if (error) throw new Error(`insertEvent: ${error.message}`)
}

export async function findLatest(
  args: FindLatestArgs
): Promise<QualityStateEvent | null> {
  // PostgREST does not natively support DISTINCT ON, but a compound index on
  // (restaurant_id, transitioned_at DESC) makes the equivalent
  // ORDER BY transitioned_at DESC LIMIT 1 effectively O(1) per tenant.
  //
  // Tiebreaker: two events that share the same transitioned_at (Meta does
  // not provide millisecond precision, so two retries within the same
  // second are common) would otherwise sort non-deterministically. Adding
  // created_at DESC as a secondary sort key gives microsecond ordering
  // (the column defaults to now() at insert time).
  //
  // Optional `phoneNumberId` filter: a tenant can have multiple phone
  // numbers, and dashboard rollups want tenant-wide history while per-
  // phone health checks want phone-scoped history. Both are supported.
  const supabase = createServerSupabaseClient()
  let query = supabase
    .from(TABLE)
    .select('*')
    .eq('restaurant_id', args.restaurantId)
  if (args.phoneNumberId !== undefined) {
    query = query.eq('phone_number_id', args.phoneNumberId)
  }
  const { data, error } = await query
    .order('transitioned_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`findLatest: ${error.message}`)
  if (!data) return null
  return toEntity(data as TenantQualityStateRow)
}

// WONB-008 Q-H: thin wrapper around the SQL `tenant_green_for_days` RPC.
// The RPC encodes the strict semantics (any non-GREEN within minDays
// disqualifies); see migration 050. We default null → false so a tenant
// with no quality history is treated as "not green long enough" — fail-safe
// for the reconfirmation pre-flight gate.
export async function isGreenForDays(
  restaurantId: string,
  minDays: number
): Promise<boolean> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase.rpc('tenant_green_for_days', {
    p_restaurant_id: restaurantId,
    p_min_days: minDays,
  })
  if (error) throw new Error(`isGreenForDays: ${error.message}`)
  return data === true
}

// Compile-time contract lock: this object MUST satisfy the domain repository
// interface. If a future edit drifts a function signature away from the port,
// TS surfaces it here rather than at the call sites or — worse — at runtime.
export const qualityStateRepository: QualityStateRepository = {
  insertEvent,
  findLatest,
  isGreenForDays,
}

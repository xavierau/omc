// WAQ-012 internal helpers for get-tenant-quality-overview.ts. Extracted
// to keep the orchestration file under the size limit.

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import type { QualityRating } from '@/domain/value-objects/quality-rating'

export interface RestaurantRow {
  id: string
  name: string
}

export interface QualityStateLatest {
  rating: QualityRating
  tier: string | null
  transitionedAt: string
}

export interface AutoPauseRow {
  active: boolean
  reason: string | null
}

interface QualityStateRawRow {
  restaurant_id: string
  quality_rating: QualityRating
  messaging_tier: string | null
  transitioned_at: string
}

interface AutoPauseRawRow {
  restaurant_id: string
  auto_pause_active: boolean | null
  auto_pause_reason: string | null
}

export async function fetchRestaurants(
  restaurantId?: string
): Promise<RestaurantRow[]> {
  return restaurantId
    ? fetchOneRestaurant(restaurantId)
    : fetchAllRestaurants()
}

async function fetchOneRestaurant(id: string): Promise<RestaurantRow[]> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('restaurants')
    .select('id, name')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`fetchRestaurants: ${error.message}`)
  return data ? [data as RestaurantRow] : []
}

async function fetchAllRestaurants(): Promise<RestaurantRow[]> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('restaurants')
    .select('id, name')
    .order('name', { ascending: true })
  if (error) throw new Error(`fetchRestaurants: ${error.message}`)
  return (data ?? []) as RestaurantRow[]
}

// Fetches the latest quality_state per restaurant via an RPC that does the
// DISTINCT ON server-side (review fix r1, Fix 1). The previous
// client-side reduce-after-sort approach pulled the entire history (no
// LIMIT) and risked silent truncation past PostgREST's 1000-row cap on
// long-lived tenants.
export async function fetchLatestQualityStates(
  restaurantIds: string[]
): Promise<Map<string, QualityStateLatest>> {
  if (restaurantIds.length === 0) return new Map()
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase.rpc(
    'get_latest_quality_states_for_tenants',
    { p_restaurant_ids: restaurantIds }
  )
  if (error) throw new Error(`fetchLatestQualityStates: ${error.message}`)
  return reduceLatestByRestaurant((data ?? []) as QualityStateRawRow[])
}

function reduceLatestByRestaurant(
  rows: QualityStateRawRow[]
): Map<string, QualityStateLatest> {
  // The RPC returns one row per restaurant_id (server-side DISTINCT ON),
  // but we keep the de-dup loop as a safety net in case the RPC ever
  // changes shape.
  const out = new Map<string, QualityStateLatest>()
  for (const r of rows) {
    if (out.has(r.restaurant_id)) continue
    out.set(r.restaurant_id, {
      rating: r.quality_rating,
      tier: r.messaging_tier,
      transitionedAt: r.transitioned_at,
    })
  }
  return out
}

export async function fetchAutoPauseFlags(
  restaurantIds: string[]
): Promise<Map<string, AutoPauseRow>> {
  if (restaurantIds.length === 0) return new Map()
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('tenant_campaign_settings')
    .select('restaurant_id, auto_pause_active, auto_pause_reason')
    .in('restaurant_id', restaurantIds)
  if (error) throw new Error(`fetchAutoPauseFlags: ${error.message}`)
  const out = new Map<string, AutoPauseRow>()
  for (const r of (data ?? []) as AutoPauseRawRow[]) {
    out.set(r.restaurant_id, {
      active: r.auto_pause_active ?? false,
      reason: r.auto_pause_reason ?? null,
    })
  }
  return out
}

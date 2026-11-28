// WAQ-011: read-only helpers for the trusted-tenant policy
// (`src/application/check-tenant-trust.ts`). Service-role reads — same
// posture as the rest of the supabase repository layer.

import { createServerSupabaseClient } from '../client'

const RED_OR_YELLOW = ['RED', 'YELLOW']

/**
 * Resolve `restaurants.created_at` for the given tenant. Returns the ISO
 * string verbatim from postgres so the caller can subtract from `now`
 * without losing precision. Throws when no restaurant matches.
 */
export async function getRestaurantCreatedAt(
  restaurantId: string
): Promise<string> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('restaurants')
    .select('created_at')
    .eq('id', restaurantId)
    .single()
  if (error || !data) {
    throw new Error(`getRestaurantCreatedAt: restaurant ${restaurantId} not found`)
  }
  return data.created_at as string
}

/**
 * Returns true if the tenant has had ANY YELLOW or RED transition in
 * `tenant_quality_state` since `since`. The compound index
 * (restaurant_id, transitioned_at DESC) makes this O(1) per tenant in
 * practice — we LIMIT 1 because a single matching row is enough.
 */
export async function hasRecentQualityIncident(args: {
  restaurantId: string
  since: string
}): Promise<boolean> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('tenant_quality_state')
    .select('id')
    .eq('restaurant_id', args.restaurantId)
    .in('quality_rating', RED_OR_YELLOW)
    .gte('transitioned_at', args.since)
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`hasRecentQualityIncident: ${error.message}`)
  return data !== null
}

/**
 * Reads ONLY `auto_pause_active` from `tenant_campaign_settings`. We don't
 * reuse `getSettingsForTenant` here because we want a much narrower
 * payload + a missing-row default of `false` (a tenant with no settings
 * row is not auto-paused).
 */
export async function isTenantAutoPaused(
  restaurantId: string
): Promise<boolean> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('tenant_campaign_settings')
    .select('auto_pause_active')
    .eq('restaurant_id', restaurantId)
    .maybeSingle()
  if (error) throw new Error(`isTenantAutoPaused: ${error.message}`)
  return data?.auto_pause_active === true
}

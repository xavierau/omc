import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import type { TenantPlan } from '@/domain/value-objects/tenant-plan'

export interface RestaurantRow {
  id: string
  slug: string
  name: string
  kapso_phone_number_id: string | null
  meta_business_account_id: string | null
  status: 'active' | 'inactive' | 'trial'
  plan: string
  trial_expires_at: string | null
  logo_url: string | null
  referrer_id: string | null
}

const RESTAURANT_COLUMNS =
  'id, slug, name, kapso_phone_number_id, meta_business_account_id, status, plan, trial_expires_at, logo_url, referrer_id'

export async function getRestaurantPhoneNumberId(
  restaurantId: string
): Promise<string> {
  const supabase = createServerSupabaseClient()

  const { data, error } = await supabase
    .from('restaurants')
    .select('kapso_phone_number_id')
    .eq('id', restaurantId)
    .single()

  if (error || !data) {
    throw new Error(`Restaurant not found: ${restaurantId}`)
  }

  const phoneNumberId = data.kapso_phone_number_id
  if (!phoneNumberId) {
    console.warn(`[Restaurant] No kapso_phone_number_id for ${restaurantId}`)
    return ''
  }
  return phoneNumberId
}

export async function getRestaurantName(restaurantId: string): Promise<string> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('restaurants')
    .select('name')
    .eq('id', restaurantId)
    .single()
  if (error || !data) throw new Error(`Restaurant not found: ${restaurantId}`)
  return data.name ?? ''
}

export async function getMetaBusinessAccountId(restaurantId: string): Promise<string | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('restaurants')
    .select('meta_business_account_id')
    .eq('id', restaurantId)
    .single()
  if (error || !data) throw new Error(`Restaurant not found: ${restaurantId}`)
  return (data.meta_business_account_id as string) ?? null
}

export async function updateMetaBusinessAccountId(restaurantId: string, wabaId: string): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase
    .from('restaurants')
    .update({ meta_business_account_id: wabaId })
    .eq('id', restaurantId)
  if (error) throw new Error(`Failed to update WABA ID: ${error.message}`)
}

export async function findBySlug(
  slug: string
): Promise<RestaurantRow | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('restaurants')
    .select(RESTAURANT_COLUMNS)
    .eq('slug', slug)
    .single()

  if (error || !data) return null
  return data as RestaurantRow
}

export async function findByPhoneNumberId(
  phoneNumberId: string
): Promise<RestaurantRow | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('restaurants')
    .select(RESTAURANT_COLUMNS)
    .eq('kapso_phone_number_id', phoneNumberId)
    .single()

  if (error || !data) return null
  return data as RestaurantRow
}

export async function listActive(): Promise<RestaurantRow[]> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('restaurants')
    .select(RESTAURANT_COLUMNS)
    .in('status', ['active', 'trial'])

  if (error) {
    throw new Error(`listActive: ${error.message}`)
  }
  return (data ?? []) as RestaurantRow[]
}

export async function updateRestaurantPlan(
  restaurantId: string,
  plan: TenantPlan
): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase
    .from('restaurants')
    .update({ plan })
    .eq('id', restaurantId)

  if (error) {
    throw new Error(`Failed to update plan: ${error.message}`)
  }
}

export async function updateLogoUrl(
  restaurantId: string,
  logoUrl: string | null
): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase
    .from('restaurants')
    .update({ logo_url: logoUrl })
    .eq('id', restaurantId)

  if (error) {
    throw new Error(`Failed to update logo: ${error.message}`)
  }
}


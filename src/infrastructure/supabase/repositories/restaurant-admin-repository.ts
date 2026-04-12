import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import type { RestaurantRow } from './restaurant-repository'

export interface CreateRestaurantInput {
  name: string
  slug: string
  whatsapp_number?: string
  kapso_phone_number_id?: string
  meta_business_account_id?: string
}

export interface UpdateRestaurantInput {
  name?: string
  whatsapp_number?: string
  kapso_phone_number_id?: string
  meta_business_account_id?: string
  status?: 'active' | 'inactive' | 'trial'
  trial_expires_at?: string | null
}

export interface TenantListItem extends RestaurantRow {
  member_count: number
  whatsapp_number: string | null
  created_at: string
}

export interface ListFilters {
  search?: string
  status?: 'active' | 'inactive' | 'trial' | 'all'
  page?: number
  limit?: number
}

export async function findById(
  id: string
): Promise<RestaurantRow | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('restaurants')
    .select('id, slug, name, kapso_phone_number_id, meta_business_account_id, status, plan, trial_expires_at, whatsapp_number, created_at')
    .eq('id', id)
    .single()

  if (error || !data) return null
  return data as RestaurantRow & { whatsapp_number: string | null; created_at: string }
}

export async function createRestaurant(
  input: CreateRestaurantInput
): Promise<RestaurantRow> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('restaurants')
    .insert(input)
    .select('id, slug, name, kapso_phone_number_id, meta_business_account_id, status, plan, trial_expires_at')
    .single()

  if (error || !data) {
    throw new Error(`createRestaurant: ${error?.message ?? 'insert failed'}`)
  }
  return data as RestaurantRow
}

export async function updateRestaurant(
  id: string,
  input: UpdateRestaurantInput
): Promise<RestaurantRow> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('restaurants')
    .update(input)
    .eq('id', id)
    .select('id, slug, name, kapso_phone_number_id, meta_business_account_id, status, plan, trial_expires_at')
    .single()

  if (error || !data) {
    throw new Error(`updateRestaurant: ${error?.message ?? 'update failed'}`)
  }
  return data as RestaurantRow
}

export async function countByStatus(): Promise<{
  active: number
  inactive: number
  trial: number
}> {
  const supabase = createServerSupabaseClient()
  const { count: active } = await supabase
    .from('restaurants')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'active')

  const { count: inactive } = await supabase
    .from('restaurants')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'inactive')

  const { count: trial } = await supabase
    .from('restaurants')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'trial')

  return { active: active ?? 0, inactive: inactive ?? 0, trial: trial ?? 0 }
}

export async function listAll(
  filters: ListFilters = {}
): Promise<{ tenants: TenantListItem[]; total: number }> {
  const supabase = createServerSupabaseClient()
  const page = filters.page ?? 1
  const limit = filters.limit ?? 20
  const from = (page - 1) * limit
  const to = from + limit - 1

  let query = supabase
    .from('restaurants')
    .select(
      'id, slug, name, kapso_phone_number_id, meta_business_account_id, status, plan, trial_expires_at, whatsapp_number, created_at, members(count)',
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .range(from, to)

  if (filters.search) {
    query = query.or(
      `name.ilike.%${filters.search}%,slug.ilike.%${filters.search}%`
    )
  }
  if (filters.status === 'active') query = query.eq('status', 'active')
  if (filters.status === 'inactive') query = query.eq('status', 'inactive')
  if (filters.status === 'trial') query = query.eq('status', 'trial')

  const { data, count, error } = await query
  if (error) throw new Error(`listAll: ${error.message}`)

  const tenants = (data ?? []).map((r: Record<string, unknown>) => ({
    ...(r as unknown as RestaurantRow),
    whatsapp_number: (r.whatsapp_number as string) ?? null,
    created_at: r.created_at as string,
    member_count: extractCount(r.members),
  }))

  return { tenants, total: count ?? 0 }
}

export interface TenantSummary {
  id: string
  name: string
  plan: string
}

export async function listAllTenantsSummary(): Promise<TenantSummary[]> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('restaurants')
    .select('id, name, plan')
    .order('name', { ascending: true })

  if (error) throw new Error(`listAllTenantsSummary: ${error.message}`)
  return (data ?? []) as TenantSummary[]
}

function extractCount(members: unknown): number {
  if (Array.isArray(members) && members.length > 0) {
    return (members[0] as { count: number }).count ?? 0
  }
  return 0
}

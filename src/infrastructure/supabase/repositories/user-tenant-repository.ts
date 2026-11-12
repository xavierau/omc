import { createServerSupabaseClient } from '@/infrastructure/supabase/client'

export interface UserTenantRow {
  id: string
  user_id: string
  restaurant_id: string
  role: string
  created_at: string
}

export async function listByRestaurantId(
  restaurantId: string
): Promise<UserTenantRow[]> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('user_tenants')
    .select('id, user_id, restaurant_id, role, created_at')
    .eq('restaurant_id', restaurantId)

  if (error) throw new Error(`listByRestaurantId: ${error.message}`)
  return (data ?? []) as UserTenantRow[]
}

export async function listByUserId(
  userId: string
): Promise<UserTenantRow[]> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('user_tenants')
    .select('id, user_id, restaurant_id, role, created_at')
    .eq('user_id', userId)

  if (error) throw new Error(`listByUserId: ${error.message}`)
  return (data ?? []) as UserTenantRow[]
}

export async function createUserTenant(
  userId: string,
  restaurantId: string,
  role: string
): Promise<UserTenantRow> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('user_tenants')
    .insert({ user_id: userId, restaurant_id: restaurantId, role })
    .select('id, user_id, restaurant_id, role, created_at')
    .single()

  if (error || !data) {
    throw new Error(`createUserTenant: ${error?.message ?? 'insert failed'}`)
  }
  return data as UserTenantRow
}

export async function deleteUserTenant(
  userId: string,
  restaurantId: string
): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase
    .from('user_tenants')
    .delete()
    .eq('user_id', userId)
    .eq('restaurant_id', restaurantId)

  if (error) throw new Error(`deleteUserTenant: ${error.message}`)
}

export async function existsUserTenant(
  userId: string,
  restaurantId: string
): Promise<boolean> {
  const supabase = createServerSupabaseClient()
  const { count, error } = await supabase
    .from('user_tenants')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('restaurant_id', restaurantId)

  if (error) throw new Error(`existsUserTenant: ${error.message}`)
  return (count ?? 0) > 0
}

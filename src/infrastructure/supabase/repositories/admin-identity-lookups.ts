// WAQ-011-DETAIL: turn the ids on admin-facing rows into names people can read.
// Platform-admin surfaces only — these cross tenants by design.

import { createServerSupabaseClient } from '../client'

/** ONE query for every distinct restaurant id; missing ids are absent from the map. */
export async function findRestaurantNamesByIds(
  ids: string[]
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('restaurants')
    .select('id, name')
    .in('id', ids)
  if (error) throw new Error(`findRestaurantNamesByIds: ${error.message}`)
  return new Map(
    ((data ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name])
  )
}

/** Auth user email, or null when the user is gone or the lookup fails. */
export async function findUserEmailById(userId: string): Promise<string | null> {
  const supabase = createServerSupabaseClient()
  try {
    const { data, error } = await supabase.auth.admin.getUserById(userId)
    if (error) {
      console.warn(`findUserEmailById(${userId}): ${error.message}`)
      return null
    }
    return data?.user?.email ?? null
  } catch (err) {
    console.warn(`findUserEmailById(${userId}):`, err)
    return null
  }
}

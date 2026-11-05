// WAQ-011-DETAIL: turn the ids on admin-facing rows into names people can read.
// Platform-admin surfaces only — these cross tenants by design.
// Display-only: every lookup degrades to an empty map (the UI falls back to
// the raw id) instead of failing the queue (review round 1, F4/F5).

import { createServerSupabaseClient } from '../client'

// PostgREST echoes the query in a response header; a few hundred UUIDs in
// one .in() overflow it (principle_postgrest_in_filter_header_overflow).
export const RESTAURANT_NAME_CHUNK = 200

// Prod has <20 auth users; one page covers them all.
const USERS_PER_PAGE = 1000

/** Restaurant names by id; empty map (names null) when the lookup fails. */
export async function findRestaurantNamesByIds(
  ids: string[]
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  try {
    const supabase = createServerSupabaseClient()
    const chunks = await Promise.all(
      chunk(ids, RESTAURANT_NAME_CHUNK).map(async (part) => {
        const { data, error } = await supabase.from('restaurants').select('id, name').in('id', part)
        if (error) throw new Error(error.message)
        return (data ?? []) as { id: string; name: string }[]
      })
    )
    return new Map(chunks.flat().map((r) => [r.id, r.name]))
  } catch (err) {
    console.warn('findRestaurantNamesByIds: degraded to ids:', err)
    return new Map()
  }
}

/** Every auth user's email by id in ONE call; empty map when it fails. */
export async function listUserEmailsById(): Promise<Map<string, string>> {
  try {
    const supabase = createServerSupabaseClient()
    const { data, error } = await supabase.auth.admin.listUsers({ perPage: USERS_PER_PAGE })
    if (error) throw new Error(error.message)
    const users = (data?.users ?? []) as { id: string; email?: string | null }[]
    return new Map(users.flatMap((u) => (u.email ? [[u.id, u.email] as const] : [])))
  } catch (err) {
    console.warn('listUserEmailsById: degraded to unknown submitters:', err)
    return new Map()
  }
}

function chunk<T>(values: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size))
  return out
}

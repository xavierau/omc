// MEM-001: attach a delivery-quality object to each listed member.
// Counts come from the member_delivery_quality RPC (migration 080); rating
// logic is the pure domain classifier. Degrades to "unknown" on any RPC error
// so the members page never goes down because of this column.

import { createServerSupabaseClient } from '../client'
import {
  CONTACT_QUALITY_WINDOW_DAYS,
  UNKNOWN_CONTACT_QUALITY,
  classifyContactQuality,
  type ContactQuality,
} from '@/domain/value-objects/contact-quality'

interface QualityRow {
  member_id: string
  delivered: number | string
  failed: number | string
}

export async function getMemberQualities(
  restaurantId: string,
  members: ReadonlyArray<{ id: string; unreachable_at: string | null }>
): Promise<Map<string, ContactQuality>> {
  const result = new Map<string, ContactQuality>()
  if (members.length === 0) return result

  const counts = await fetchCounts(restaurantId, members.map((m) => m.id))
  for (const m of members) {
    const c = counts.get(m.id)
    result.set(
      m.id,
      classifyContactQuality({
        delivered: c?.delivered ?? 0,
        failed: c?.failed ?? 0,
        unreachable: m.unreachable_at !== null,
      })
    )
  }
  return result
}

async function fetchCounts(
  restaurantId: string,
  memberIds: string[]
): Promise<Map<string, { delivered: number; failed: number }>> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase.rpc('member_delivery_quality', {
    p_restaurant_id: restaurantId,
    p_member_ids: memberIds,
    p_window_days: CONTACT_QUALITY_WINDOW_DAYS,
  })
  if (error) throw new Error(`member_delivery_quality: ${error.message}`)
  // bigint columns can arrive as strings; coerce.
  return new Map(
    ((data ?? []) as QualityRow[]).map((r) => [
      r.member_id,
      { delivered: Number(r.delivered), failed: Number(r.failed) },
    ])
  )
}

/** Never throws: any failure yields "unknown" for every member. */
export async function getMemberQualitiesSafe(
  restaurantId: string,
  members: ReadonlyArray<{ id: string; unreachable_at: string | null }>
): Promise<Map<string, ContactQuality>> {
  try {
    return await getMemberQualities(restaurantId, members)
  } catch (error) {
    console.warn('member_delivery_quality RPC failed; returning unknown quality', error)
    return new Map(members.map((m) => [m.id, { ...UNKNOWN_CONTACT_QUALITY }]))
  }
}

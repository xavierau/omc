import { createServerSupabaseClient } from '../client'

/**
 * Live recipient count for campaign tag-targeting (migration 067, AD-6).
 * One RPC round trip returns count(DISTINCT member) across every selected
 * tag, tenant-scoped and status='active' — avoids both the PostgREST
 * URL-length blowup a JS-side `.in('id', memberIds)` would hit at scale and
 * the over-count a `!inner` embed with `count:'exact'` produces for a
 * member carrying more than one of the selected tags.
 *
 * Caller (the recipient-count route) must call assertTagsBelongToTenant
 * BEFORE this — the RPC itself trusts p_restaurant_id/p_tag_ids as given.
 */
export async function countActiveMembersByTags(
  tagIds: string[],
  restaurantId: string
): Promise<number> {
  if (tagIds.length === 0) return 0
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase.rpc('count_active_members_by_tags', {
    p_restaurant_id: restaurantId,
    p_tag_ids: tagIds,
  })
  if (error) throw new Error(`countActiveMembersByTags: ${error.message}`)
  return Number(data ?? 0)
}

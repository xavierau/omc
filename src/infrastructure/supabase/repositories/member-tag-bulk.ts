// TAG-001 (B3): tenant assertions + bulk delete for the members-list bulk
// tag/untag route. `upsertMemberTags` (add path) already lives in
// member-tag-repository.ts and is reused as-is. The service-role client
// bypasses RLS on `member_tags`, so ownership is re-asserted here by scoped
// query — never fetch-then-compare (principle_authorize_by_scoped_query).

import { createServerSupabaseClient } from '../client'
import { CrossTenantMemberError } from './campaign-members-repository'

/** Re-assert every memberId belongs to the caller's tenant before a write. */
export async function assertMembersBelongToTenant(
  memberIds: string[],
  restaurantId: string
): Promise<void> {
  if (memberIds.length === 0) return
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('members')
    .select('id')
    .eq('restaurant_id', restaurantId)
    .in('id', memberIds)
  if (error) throw new Error(`assertMembersBelongToTenant: ${error.message}`)
  const validIds = new Set((data ?? []).map((r) => r.id as string))
  if (validIds.size !== new Set(memberIds).size) {
    throw new CrossTenantMemberError('Invalid member IDs')
  }
}

/**
 * Remove the memberIds×tagIds cross-product. Returns the deleted row count.
 *
 * The count comes from `delete({ count: 'exact' })`, not from counting returned
 * rows: a returned representation is capped at PostgREST `max-rows` (1000 by
 * default), so above that the caller would be told fewer pairs were removed
 * than actually were (review I-5(d)).
 */
export async function deleteMemberTagsBulk(
  restaurantId: string,
  memberIds: string[],
  tagIds: string[]
): Promise<number> {
  if (memberIds.length === 0 || tagIds.length === 0) return 0
  const supabase = createServerSupabaseClient()
  const { count, error } = await supabase
    .from('member_tags')
    .delete({ count: 'exact' })
    .eq('restaurant_id', restaurantId)
    .in('member_id', memberIds)
    .in('tag_id', tagIds)
  if (error) throw new Error(`deleteMemberTagsBulk: ${error.message}`)
  return count ?? 0
}

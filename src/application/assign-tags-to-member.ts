// TAG-001: assign one or more existing tags to a single member.
// Lazy-flow authorization parity: the memberId and every tagId come from the
// request, so both are re-asserted against the caller's tenant BEFORE any
// write (all writes use the service-role client, which bypasses RLS). The
// upsert is idempotent — re-assigning an already-present tag is a no-op.

import {
  assertMemberBelongsToTenant,
  assertTagsBelongToTenant,
  upsertMemberTags,
} from '@/infrastructure/supabase/repositories/member-tag-repository'

export interface AssignTagsToMemberInput {
  restaurantId: string
  memberId: string
  tagIds: string[]
}

export async function assignTagsToMember(
  input: AssignTagsToMemberInput
): Promise<void> {
  const { restaurantId, memberId, tagIds } = input
  if (tagIds.length === 0) return
  await assertMemberBelongsToTenant(memberId, restaurantId)
  await assertTagsBelongToTenant(tagIds, restaurantId)
  await upsertMemberTags(restaurantId, [memberId], tagIds)
}

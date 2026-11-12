// TAG-001: remove a single tag from a member. Lazy-flow authorization parity:
// re-assert both the member and the tag belong to the caller's tenant before
// deleting (service-role writes bypass RLS). Removing a tag the member does
// not carry is a no-op success (the delete affects zero rows).

import {
  assertMemberBelongsToTenant,
  assertTagsBelongToTenant,
  deleteMemberTag,
} from '@/infrastructure/supabase/repositories/member-tag-repository'

export interface RemoveTagFromMemberInput {
  restaurantId: string
  memberId: string
  tagId: string
}

export async function removeTagFromMember(
  input: RemoveTagFromMemberInput
): Promise<void> {
  const { restaurantId, memberId, tagId } = input
  await assertMemberBelongsToTenant(memberId, restaurantId)
  await assertTagsBelongToTenant([tagId], restaurantId)
  await deleteMemberTag(memberId, tagId, restaurantId)
}

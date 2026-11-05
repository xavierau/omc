// TAG-001: bulk-apply the wizard's selected tags to every member created OR
// merged in an import batch. Called once after the fan-out (O(1) round-trips).
// The members are all this batch's tenant, so only the tagIds (from the
// request) need a tenant assertion. Null ids (consent-only rows) are skipped.
// The upsert is idempotent — re-importing/merging a member adds the tag
// without duplication.

import {
  assertTagsBelongToTenant,
  upsertMemberTags,
} from '@/infrastructure/supabase/repositories/member-tag-repository'

export interface AssignTagsToImportedMembersInput {
  restaurantId: string
  memberIds: Array<string | null | undefined>
  tagIds: string[]
}

export async function assignTagsToImportedMembers(
  input: AssignTagsToImportedMembersInput
): Promise<void> {
  const { restaurantId, tagIds } = input
  const memberIds = input.memberIds.filter((id): id is string => Boolean(id))
  if (tagIds.length === 0 || memberIds.length === 0) return
  await assertTagsBelongToTenant(tagIds, restaurantId)
  await upsertMemberTags(restaurantId, memberIds, tagIds)
}

// TAG-001 (B3): bulk tag/untag use case for the members-list selection bar
// (AD-7 — one route, one tenant assertion pass, one write, no per-member
// round trips). Both tag and member ids are re-asserted against the caller's
// tenant BEFORE any write (Invariant 5) so a foreign id never causes a
// partial write.

import {
  assertTagsBelongToTenant,
  upsertMemberTags,
} from '@/infrastructure/supabase/repositories/member-tag-repository'
import {
  assertMembersBelongToTenant,
  deleteMemberTagsBulk,
} from '@/infrastructure/supabase/repositories/member-tag-bulk'

export const MAX_BULK_MEMBER_IDS = 500
export const MAX_BULK_TAG_IDS = 20

export type BulkMemberTagAction = 'add' | 'remove'

export interface BulkUpdateMemberTagsInput {
  restaurantId: string
  memberIds: string[]
  tagIds: string[]
  action: BulkMemberTagAction
}

export interface BulkUpdateMemberTagsResult {
  affected: number
}

export class BulkMemberTagValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BulkMemberTagValidationError'
  }
}

export async function bulkUpdateMemberTags(
  input: BulkUpdateMemberTagsInput
): Promise<BulkUpdateMemberTagsResult> {
  const { restaurantId, memberIds, tagIds, action } = input
  if (memberIds.length > MAX_BULK_MEMBER_IDS) {
    throw new BulkMemberTagValidationError(
      `At most ${MAX_BULK_MEMBER_IDS} members per bulk update`
    )
  }
  if (tagIds.length > MAX_BULK_TAG_IDS) {
    throw new BulkMemberTagValidationError(`At most ${MAX_BULK_TAG_IDS} tags per bulk update`)
  }

  await assertTagsBelongToTenant(tagIds, restaurantId)
  await assertMembersBelongToTenant(memberIds, restaurantId)

  if (action === 'add') {
    await upsertMemberTags(restaurantId, memberIds, tagIds)
    // R-10: upsert is idempotent so its own delta can't be observed here —
    // report the requested member count instead of over-claiming.
    return { affected: memberIds.length }
  }

  const affected = await deleteMemberTagsBulk(restaurantId, memberIds, tagIds)
  return { affected }
}

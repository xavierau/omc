// TAG-001: read a member's tags. The repository query is tenant-scoped
// (restaurant_id), so a cross-tenant memberId yields an empty list.

import type { Tag } from '@/domain/entities/tag'
import { listTagsForMember } from '@/infrastructure/supabase/repositories/member-tag-repository'

export async function listMemberTags(
  restaurantId: string,
  memberId: string
): Promise<Tag[]> {
  return listTagsForMember(memberId, restaurantId)
}

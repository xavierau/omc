// TAG-001: rename a tag. The name is validated/normalized before the write; the
// repo scopes the update by restaurant_id (lazy-flow authorization parity) so a
// tagId from another tenant yields TagNotFoundError, never a cross-tenant write.

import { normalizeTagName, type Tag } from '@/domain/entities/tag'
import { tagRepository } from '@/infrastructure/supabase/repositories/tag-repository'

export interface RenameTagInput {
  restaurantId: string
  tagId: string
  name: string
}

export async function renameTag(input: RenameTagInput): Promise<Tag> {
  const name = normalizeTagName(input.name)
  return tagRepository.rename(input.tagId, input.restaurantId, name)
}

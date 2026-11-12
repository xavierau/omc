// TAG-001: create a tenant-owned tag. Tag.create trims/validates the name and
// applies the default color; the repo enforces case-insensitive uniqueness and
// raises TagNameConflictError (→ 409) on a duplicate.

import { Tag, type CreateTagInput } from '@/domain/entities/tag'
import { tagRepository } from '@/infrastructure/supabase/repositories/tag-repository'

export async function createTag(input: CreateTagInput): Promise<Tag> {
  return tagRepository.insert(Tag.create(input))
}

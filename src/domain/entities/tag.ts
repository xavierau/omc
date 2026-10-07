// TAG-001: Tag is a tenant-owned aggregate. The name is trimmed, non-empty and
// <= 40 chars; uniqueness per restaurant is case-insensitive and enforced by the
// DB (idx_tags_restaurant_lower_name, migration 065). Zero infra dependencies.

import { TagValidationError } from '@/domain/services/__errors__/tag-errors'

export const DEFAULT_TAG_COLOR = '#6B7280'
const MAX_TAG_NAME_LEN = 40

/** A persisted tag (id + createdAt come from DB defaults). */
export interface Tag {
  id: string
  restaurantId: string
  name: string
  color: string
  createdAt: string
}

/** Validated attributes ready to be inserted; DB fills id + createdAt. */
export interface NewTag {
  restaurantId: string
  name: string
  color: string
}

export interface CreateTagInput {
  restaurantId: string
  name: string
  color?: string
}

export const Tag = {
  create(input: CreateTagInput): NewTag {
    return {
      restaurantId: input.restaurantId,
      name: normalizeTagName(input.name),
      color: input.color ?? DEFAULT_TAG_COLOR,
    }
  },
}

/** Trim + validate a tag name. Reused by create and the rename use-case. */
export function normalizeTagName(name: string): string {
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (trimmed.length === 0) {
    throw new TagValidationError('empty_name')
  }
  if (trimmed.length > MAX_TAG_NAME_LEN) {
    throw new TagValidationError('name_too_long')
  }
  return trimmed
}

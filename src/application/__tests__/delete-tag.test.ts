import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/tag-repository', () => {
  class TagNameConflictError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'TagNameConflictError'
    }
  }
  class TagNotFoundError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'TagNotFoundError'
    }
  }
  return {
    tagRepository: {
      insert: vi.fn(),
      listByRestaurant: vi.fn(),
      rename: vi.fn(),
      remove: vi.fn(),
      findIdsByRestaurant: vi.fn(),
    },
    TagNameConflictError,
    TagNotFoundError,
  }
})

import {
  tagRepository,
  TagNotFoundError,
} from '@/infrastructure/supabase/repositories/tag-repository'
import { deleteTag } from '../delete-tag'

const RESTAURANT = 'rest-1'

beforeEach(() => vi.clearAllMocks())

describe('deleteTag', () => {
  it('happy path — removes the tag scoped by tenant (DB cascade clears associations) (AC1)', async () => {
    vi.mocked(tagRepository.remove).mockResolvedValue(undefined)

    await expect(
      deleteTag({ restaurantId: RESTAURANT, tagId: 'tag-1' })
    ).resolves.toBeUndefined()
    expect(tagRepository.remove).toHaveBeenCalledWith('tag-1', RESTAURANT)
  })

  it('cross-tenant tagId → TagNotFoundError; tenant id comes from context, not the body (AC6)', async () => {
    vi.mocked(tagRepository.remove).mockRejectedValue(
      new TagNotFoundError('not found')
    )

    await expect(
      deleteTag({ restaurantId: RESTAURANT, tagId: 'other-tenant-tag' })
    ).rejects.toBeInstanceOf(TagNotFoundError)
    expect(tagRepository.remove).toHaveBeenCalledWith('other-tenant-tag', RESTAURANT)
  })
})

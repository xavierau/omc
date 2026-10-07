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
  TagNameConflictError,
  TagNotFoundError,
} from '@/infrastructure/supabase/repositories/tag-repository'
import { renameTag } from '../rename-tag'

const RESTAURANT = 'rest-1'

beforeEach(() => vi.clearAllMocks())

describe('renameTag', () => {
  it('happy path — trims the name, scopes the update by tenant, returns the tag', async () => {
    vi.mocked(tagRepository.rename).mockResolvedValue({
      id: 'tag-1',
      restaurantId: RESTAURANT,
      name: 'Regular',
      color: '#6B7280',
      createdAt: 'x',
    })

    const tag = await renameTag({
      restaurantId: RESTAURANT,
      tagId: 'tag-1',
      name: '  Regular  ',
    })

    expect(tagRepository.rename).toHaveBeenCalledWith('tag-1', RESTAURANT, 'Regular')
    expect(tag.name).toBe('Regular')
  })

  it('cross-tenant tagId → TagNotFoundError; tenant id comes from context, not the body (AC6)', async () => {
    vi.mocked(tagRepository.rename).mockRejectedValue(
      new TagNotFoundError('not found')
    )

    await expect(
      renameTag({ restaurantId: RESTAURANT, tagId: 'other-tenant-tag', name: 'X' })
    ).rejects.toBeInstanceOf(TagNotFoundError)
    expect(tagRepository.rename).toHaveBeenCalledWith(
      'other-tenant-tag',
      RESTAURANT,
      'X'
    )
  })

  it('duplicate target name → propagates TagNameConflictError', async () => {
    vi.mocked(tagRepository.rename).mockRejectedValue(
      new TagNameConflictError('duplicate')
    )

    await expect(
      renameTag({ restaurantId: RESTAURANT, tagId: 'tag-1', name: 'Existing' })
    ).rejects.toBeInstanceOf(TagNameConflictError)
  })

  it('rejects an empty name without hitting the repo', async () => {
    await expect(
      renameTag({ restaurantId: RESTAURANT, tagId: 'tag-1', name: '  ' })
    ).rejects.toMatchObject({ name: 'TagValidationError', reason: 'empty_name' })
    expect(tagRepository.rename).not.toHaveBeenCalled()
  })
})

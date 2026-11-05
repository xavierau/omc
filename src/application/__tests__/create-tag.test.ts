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
} from '@/infrastructure/supabase/repositories/tag-repository'
import { DEFAULT_TAG_COLOR } from '@/domain/entities/tag'
import { createTag } from '../create-tag'

const RESTAURANT = 'rest-1'

beforeEach(() => vi.clearAllMocks())

describe('createTag', () => {
  it('happy path — trims the name, applies default color, returns the persisted tag', async () => {
    vi.mocked(tagRepository.insert).mockImplementation(async (t) => ({
      id: 'tag-1',
      restaurantId: t.restaurantId,
      name: t.name,
      color: t.color,
      createdAt: '2026-07-03T00:00:00Z',
    }))

    const tag = await createTag({ restaurantId: RESTAURANT, name: '  VIP  ' })

    expect(tagRepository.insert).toHaveBeenCalledWith({
      restaurantId: RESTAURANT,
      name: 'VIP',
      color: DEFAULT_TAG_COLOR,
    })
    expect(tag).toMatchObject({ id: 'tag-1', name: 'VIP', color: DEFAULT_TAG_COLOR })
  })

  it('applies the default color when none is provided', async () => {
    vi.mocked(tagRepository.insert).mockResolvedValue({
      id: 'tag-1',
      restaurantId: RESTAURANT,
      name: 'VIP',
      color: DEFAULT_TAG_COLOR,
      createdAt: 'x',
    })

    await createTag({ restaurantId: RESTAURANT, name: 'VIP' })

    expect(vi.mocked(tagRepository.insert).mock.calls[0][0].color).toBe(
      DEFAULT_TAG_COLOR
    )
  })

  it('duplicate name (same case) → propagates TagNameConflictError (AC1)', async () => {
    vi.mocked(tagRepository.insert).mockRejectedValue(
      new TagNameConflictError('duplicate')
    )

    await expect(
      createTag({ restaurantId: RESTAURANT, name: 'VIP' })
    ).rejects.toBeInstanceOf(TagNameConflictError)
  })

  it('duplicate name (DIFFERENT case) → conflict; app keeps the entered case (AC1)', async () => {
    // The DB lower(name) unique index folds case. The app must NOT lowercase —
    // display preserves the entered case and the repo still raises 23505.
    vi.mocked(tagRepository.insert).mockRejectedValue(
      new TagNameConflictError('duplicate')
    )

    await expect(
      createTag({ restaurantId: RESTAURANT, name: 'vip' })
    ).rejects.toBeInstanceOf(TagNameConflictError)
    expect(vi.mocked(tagRepository.insert).mock.calls[0][0].name).toBe('vip')
  })

  it('rejects an empty / whitespace-only name without hitting the repo', async () => {
    await expect(
      createTag({ restaurantId: RESTAURANT, name: '   ' })
    ).rejects.toMatchObject({ name: 'TagValidationError', reason: 'empty_name' })
    expect(tagRepository.insert).not.toHaveBeenCalled()
  })

  it('rejects a name longer than 40 chars without hitting the repo', async () => {
    await expect(
      createTag({ restaurantId: RESTAURANT, name: 'a'.repeat(41) })
    ).rejects.toMatchObject({
      name: 'TagValidationError',
      reason: 'name_too_long',
    })
    expect(tagRepository.insert).not.toHaveBeenCalled()
  })
})

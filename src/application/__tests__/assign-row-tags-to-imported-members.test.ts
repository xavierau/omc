import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/tag-get-or-create', () => ({
  getOrCreateTagsByName: vi.fn(),
}))

vi.mock('@/infrastructure/supabase/repositories/member-tag-pairs', () => ({
  upsertMemberTagPairs: vi.fn(),
}))

import { getOrCreateTagsByName } from '@/infrastructure/supabase/repositories/tag-get-or-create'
import { upsertMemberTagPairs } from '@/infrastructure/supabase/repositories/member-tag-pairs'
import { assignRowTagsToImportedMembers } from '../assign-row-tags-to-imported-members'

const RESTAURANT_ID = 'rest-1'

function resolves(entries: Array<[string, string]>) {
  vi.mocked(getOrCreateTagsByName).mockResolvedValue(new Map(entries))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(upsertMemberTagPairs).mockResolvedValue(undefined)
})

describe('assignRowTagsToImportedMembers', () => {
  // T-B2.1
  it('resolves the distinct names once and writes one pair per (member, tag)', async () => {
    resolves([
      ['vip', 't-vip'],
      ['lunch', 't-lunch'],
    ])

    const result = await assignRowTagsToImportedMembers({
      restaurantId: RESTAURANT_ID,
      rows: [
        { memberId: 'm-1', tagNames: ['VIP', 'Lunch'] },
        { memberId: 'm-2', tagNames: ['VIP'] },
      ],
    })

    expect(getOrCreateTagsByName).toHaveBeenCalledTimes(1)
    expect(getOrCreateTagsByName).toHaveBeenCalledWith(RESTAURANT_ID, ['VIP', 'Lunch'])
    expect(upsertMemberTagPairs).toHaveBeenCalledWith(RESTAURANT_ID, [
      { memberId: 'm-1', tagId: 't-vip' },
      { memberId: 'm-1', tagId: 't-lunch' },
      { memberId: 'm-2', tagId: 't-vip' },
    ])
    expect(result).toEqual({ taggedMembers: 2 })
  })

  // T-B1.6 carried into commit: 'VIP' on one row and 'vip' on another are ONE tag.
  it('dedupes names across rows case-insensitively, first-seen casing wins', async () => {
    resolves([['vip', 't-vip']])

    await assignRowTagsToImportedMembers({
      restaurantId: RESTAURANT_ID,
      rows: [
        { memberId: 'm-1', tagNames: ['VIP'] },
        { memberId: 'm-2', tagNames: ['vip'] },
      ],
    })

    expect(getOrCreateTagsByName).toHaveBeenCalledWith(RESTAURANT_ID, ['VIP'])
  })

  // T-B2.2 / replacement for T-B2.9: mapping is by tagKey, not raw string.
  it('maps a differently-cased CSV name onto the existing tag id', async () => {
    resolves([['vip', 't-existing-vip']])

    await assignRowTagsToImportedMembers({
      restaurantId: RESTAURANT_ID,
      rows: [{ memberId: 'm-1', tagNames: ['vIp'] }],
    })

    expect(upsertMemberTagPairs).toHaveBeenCalledWith(RESTAURANT_ID, [
      { memberId: 'm-1', tagId: 't-existing-vip' },
    ])
  })

  // Server never trusts upstream casing/whitespace/dupes — B1 hand-off note.
  it('re-normalises names via normalizeImportTagNames before resolving', async () => {
    resolves([['vip', 't-vip']])

    await assignRowTagsToImportedMembers({
      restaurantId: RESTAURANT_ID,
      rows: [{ memberId: 'm-1', tagNames: ['  VIP  ', 'vip', '', '   '] }],
    })

    expect(getOrCreateTagsByName).toHaveBeenCalledWith(RESTAURANT_ID, ['VIP'])
    expect(upsertMemberTagPairs).toHaveBeenCalledWith(RESTAURANT_ID, [
      { memberId: 'm-1', tagId: 't-vip' },
    ])
  })

  it('drops names longer than 40 characters (tags_name_check parity)', async () => {
    resolves([['keep', 't-keep']])

    await assignRowTagsToImportedMembers({
      restaurantId: RESTAURANT_ID,
      rows: [{ memberId: 'm-1', tagNames: ['x'.repeat(41), 'keep'] }],
    })

    expect(getOrCreateTagsByName).toHaveBeenCalledWith(RESTAURANT_ID, ['keep'])
  })

  it('emits one pair when the same member is listed twice with the same tag', async () => {
    resolves([['vip', 't-vip']])

    const result = await assignRowTagsToImportedMembers({
      restaurantId: RESTAURANT_ID,
      rows: [
        { memberId: 'm-1', tagNames: ['VIP'] },
        { memberId: 'm-1', tagNames: ['vip'] },
      ],
    })

    expect(upsertMemberTagPairs).toHaveBeenCalledWith(RESTAURANT_ID, [
      { memberId: 'm-1', tagId: 't-vip' },
    ])
    expect(result).toEqual({ taggedMembers: 1 })
  })

  it('is a no-op for an empty row list', async () => {
    const result = await assignRowTagsToImportedMembers({
      restaurantId: RESTAURANT_ID,
      rows: [],
    })

    expect(getOrCreateTagsByName).not.toHaveBeenCalled()
    expect(upsertMemberTagPairs).not.toHaveBeenCalled()
    expect(result).toEqual({ taggedMembers: 0 })
  })

  it('is a no-op when every row normalises to zero tags', async () => {
    const result = await assignRowTagsToImportedMembers({
      restaurantId: RESTAURANT_ID,
      rows: [{ memberId: 'm-1', tagNames: ['', '   '] }],
    })

    expect(getOrCreateTagsByName).not.toHaveBeenCalled()
    expect(upsertMemberTagPairs).not.toHaveBeenCalled()
    expect(result).toEqual({ taggedMembers: 0 })
  })

  // Plan R-4: never silently drop a tag.
  it('throws when the resolver does not return an id for a requested name', async () => {
    resolves([])

    await expect(
      assignRowTagsToImportedMembers({
        restaurantId: RESTAURANT_ID,
        rows: [{ memberId: 'm-1', tagNames: ['VIP'] }],
      })
    ).rejects.toThrow(/VIP/)

    expect(upsertMemberTagPairs).not.toHaveBeenCalled()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/member-tag-repository')
vi.mock('@/infrastructure/supabase/repositories/member-tag-bulk')

import {
  assertTagsBelongToTenant,
  upsertMemberTags,
  CrossTenantTagError,
} from '@/infrastructure/supabase/repositories/member-tag-repository'
import {
  assertMembersBelongToTenant,
  deleteMemberTagsBulk,
} from '@/infrastructure/supabase/repositories/member-tag-bulk'
import { CrossTenantMemberError } from '@/infrastructure/supabase/repositories/campaign-members-repository'
import {
  bulkUpdateMemberTags,
  BulkMemberTagValidationError,
} from '../bulk-update-member-tags'

const RESTAURANT_ID = 'rest-1'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(assertTagsBelongToTenant).mockResolvedValue(undefined)
  vi.mocked(assertMembersBelongToTenant).mockResolvedValue(undefined)
  vi.mocked(upsertMemberTags).mockResolvedValue(undefined)
  vi.mocked(deleteMemberTagsBulk).mockResolvedValue(0)
})

describe('bulkUpdateMemberTags — add', () => {
  it('asserts tenancy on both members and tags before writing, then upserts', async () => {
    const result = await bulkUpdateMemberTags({
      restaurantId: RESTAURANT_ID,
      memberIds: ['m-1', 'm-2', 'm-3'],
      tagIds: ['t-1', 't-2'],
      action: 'add',
    })
    expect(assertTagsBelongToTenant).toHaveBeenCalledWith(['t-1', 't-2'], RESTAURANT_ID)
    expect(assertMembersBelongToTenant).toHaveBeenCalledWith(
      ['m-1', 'm-2', 'm-3'],
      RESTAURANT_ID
    )
    expect(upsertMemberTags).toHaveBeenCalledWith(
      RESTAURANT_ID,
      ['m-1', 'm-2', 'm-3'],
      ['t-1', 't-2']
    )
    expect(deleteMemberTagsBulk).not.toHaveBeenCalled()
    // R-10: add reports the requested member count, not a true upsert delta.
    expect(result).toEqual({ affected: 3 })
  })
})

describe('bulkUpdateMemberTags — remove', () => {
  it('asserts tenancy, then deletes and reports the deleted row count', async () => {
    vi.mocked(deleteMemberTagsBulk).mockResolvedValue(4)
    const result = await bulkUpdateMemberTags({
      restaurantId: RESTAURANT_ID,
      memberIds: ['m-1', 'm-2'],
      tagIds: ['t-1'],
      action: 'remove',
    })
    expect(deleteMemberTagsBulk).toHaveBeenCalledWith(RESTAURANT_ID, ['m-1', 'm-2'], ['t-1'])
    expect(upsertMemberTags).not.toHaveBeenCalled()
    expect(result).toEqual({ affected: 4 })
  })

  it('removing a tag no member carries is a no-op, not an error', async () => {
    vi.mocked(deleteMemberTagsBulk).mockResolvedValue(0)
    const result = await bulkUpdateMemberTags({
      restaurantId: RESTAURANT_ID,
      memberIds: ['m-1'],
      tagIds: ['t-x'],
      action: 'remove',
    })
    expect(result).toEqual({ affected: 0 })
  })
})

describe('bulkUpdateMemberTags — caps', () => {
  it('rejects more than 500 member ids without asserting or writing', async () => {
    const memberIds = Array.from({ length: 501 }, (_, i) => `m-${i}`)
    await expect(
      bulkUpdateMemberTags({
        restaurantId: RESTAURANT_ID,
        memberIds,
        tagIds: ['t-1'],
        action: 'add',
      })
    ).rejects.toBeInstanceOf(BulkMemberTagValidationError)
    expect(assertTagsBelongToTenant).not.toHaveBeenCalled()
    expect(assertMembersBelongToTenant).not.toHaveBeenCalled()
    expect(upsertMemberTags).not.toHaveBeenCalled()
    expect(deleteMemberTagsBulk).not.toHaveBeenCalled()
  })

  it('rejects more than 20 tag ids without asserting or writing', async () => {
    const tagIds = Array.from({ length: 21 }, (_, i) => `t-${i}`)
    await expect(
      bulkUpdateMemberTags({
        restaurantId: RESTAURANT_ID,
        memberIds: ['m-1'],
        tagIds,
        action: 'add',
      })
    ).rejects.toBeInstanceOf(BulkMemberTagValidationError)
    expect(assertTagsBelongToTenant).not.toHaveBeenCalled()
    expect(upsertMemberTags).not.toHaveBeenCalled()
  })

  it('accepts exactly the caps (500 members, 20 tags)', async () => {
    const memberIds = Array.from({ length: 500 }, (_, i) => `m-${i}`)
    const tagIds = Array.from({ length: 20 }, (_, i) => `t-${i}`)
    await expect(
      bulkUpdateMemberTags({
        restaurantId: RESTAURANT_ID,
        memberIds,
        tagIds,
        action: 'add',
      })
    ).resolves.toEqual({ affected: 500 })
  })
})

describe('bulkUpdateMemberTags — cross-tenant, no partial write', () => {
  it('a foreign tag id rejects before any write', async () => {
    vi.mocked(assertTagsBelongToTenant).mockRejectedValueOnce(
      new CrossTenantTagError('Invalid tag IDs')
    )
    await expect(
      bulkUpdateMemberTags({
        restaurantId: RESTAURANT_ID,
        memberIds: ['m-1'],
        tagIds: ['t-x'],
        action: 'add',
      })
    ).rejects.toBeInstanceOf(CrossTenantTagError)
    expect(upsertMemberTags).not.toHaveBeenCalled()
    expect(deleteMemberTagsBulk).not.toHaveBeenCalled()
  })

  it('a foreign member id rejects before any write', async () => {
    vi.mocked(assertMembersBelongToTenant).mockRejectedValueOnce(
      new CrossTenantMemberError('Invalid member IDs')
    )
    await expect(
      bulkUpdateMemberTags({
        restaurantId: RESTAURANT_ID,
        memberIds: ['m-x'],
        tagIds: ['t-1'],
        action: 'remove',
      })
    ).rejects.toBeInstanceOf(CrossTenantMemberError)
    expect(upsertMemberTags).not.toHaveBeenCalled()
    expect(deleteMemberTagsBulk).not.toHaveBeenCalled()
  })
})

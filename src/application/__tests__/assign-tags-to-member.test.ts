import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/member-tag-repository', () => ({
  assertMemberBelongsToTenant: vi.fn(),
  assertTagsBelongToTenant: vi.fn(),
  upsertMemberTags: vi.fn(),
}))

import {
  assertMemberBelongsToTenant,
  assertTagsBelongToTenant,
  upsertMemberTags,
} from '@/infrastructure/supabase/repositories/member-tag-repository'
import { assignTagsToMember } from '../assign-tags-to-member'

const RESTAURANT_ID = 'rest-1'
const MEMBER_ID = 'mem-1'

beforeEach(() => vi.clearAllMocks())

describe('assignTagsToMember', () => {
  it('asserts member and tags belong to the tenant, then upserts', async () => {
    await assignTagsToMember({
      restaurantId: RESTAURANT_ID,
      memberId: MEMBER_ID,
      tagIds: ['t-1', 't-2'],
    })

    expect(assertMemberBelongsToTenant).toHaveBeenCalledWith(MEMBER_ID, RESTAURANT_ID)
    expect(assertTagsBelongToTenant).toHaveBeenCalledWith(['t-1', 't-2'], RESTAURANT_ID)
    expect(upsertMemberTags).toHaveBeenCalledWith(RESTAURANT_ID, [MEMBER_ID], ['t-1', 't-2'])
  })

  it('is idempotent — re-assigning the same tags upserts again without error', async () => {
    const input = { restaurantId: RESTAURANT_ID, memberId: MEMBER_ID, tagIds: ['t-1'] }
    await assignTagsToMember(input)
    await assignTagsToMember(input)

    expect(upsertMemberTags).toHaveBeenCalledTimes(2)
    expect(upsertMemberTags).toHaveBeenNthCalledWith(2, RESTAURANT_ID, [MEMBER_ID], ['t-1'])
  })

  it('rejects when a tag belongs to another tenant and does not write', async () => {
    vi.mocked(assertTagsBelongToTenant).mockRejectedValueOnce(new Error('Invalid tag IDs'))

    await expect(
      assignTagsToMember({ restaurantId: RESTAURANT_ID, memberId: MEMBER_ID, tagIds: ['t-x'] })
    ).rejects.toThrow('Invalid tag IDs')
    expect(upsertMemberTags).not.toHaveBeenCalled()
  })

  it('rejects when the member belongs to another tenant and does not check tags or write', async () => {
    vi.mocked(assertMemberBelongsToTenant).mockRejectedValueOnce(new Error('Invalid member ID'))

    await expect(
      assignTagsToMember({ restaurantId: RESTAURANT_ID, memberId: 'other', tagIds: ['t-1'] })
    ).rejects.toThrow('Invalid member ID')
    expect(assertTagsBelongToTenant).not.toHaveBeenCalled()
    expect(upsertMemberTags).not.toHaveBeenCalled()
  })

  it('is a no-op when tagIds is empty (no assertions, no write)', async () => {
    await assignTagsToMember({ restaurantId: RESTAURANT_ID, memberId: MEMBER_ID, tagIds: [] })

    expect(assertMemberBelongsToTenant).not.toHaveBeenCalled()
    expect(assertTagsBelongToTenant).not.toHaveBeenCalled()
    expect(upsertMemberTags).not.toHaveBeenCalled()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/member-tag-repository', () => ({
  assertMemberBelongsToTenant: vi.fn(),
  assertTagsBelongToTenant: vi.fn(),
  deleteMemberTag: vi.fn(),
}))

import {
  assertMemberBelongsToTenant,
  assertTagsBelongToTenant,
  deleteMemberTag,
} from '@/infrastructure/supabase/repositories/member-tag-repository'
import { removeTagFromMember } from '../remove-tag-from-member'

const RESTAURANT_ID = 'rest-1'
const MEMBER_ID = 'mem-1'
const TAG_ID = 't-1'

beforeEach(() => vi.clearAllMocks())

describe('removeTagFromMember', () => {
  it('asserts ownership then deletes the (member, tag) pair', async () => {
    await removeTagFromMember({
      restaurantId: RESTAURANT_ID,
      memberId: MEMBER_ID,
      tagId: TAG_ID,
    })

    expect(assertMemberBelongsToTenant).toHaveBeenCalledWith(MEMBER_ID, RESTAURANT_ID)
    expect(assertTagsBelongToTenant).toHaveBeenCalledWith([TAG_ID], RESTAURANT_ID)
    expect(deleteMemberTag).toHaveBeenCalledWith(MEMBER_ID, TAG_ID, RESTAURANT_ID)
  })

  it('is a no-op success when the member does not carry the tag (delete affects 0 rows)', async () => {
    vi.mocked(deleteMemberTag).mockResolvedValueOnce(undefined)

    await expect(
      removeTagFromMember({ restaurantId: RESTAURANT_ID, memberId: MEMBER_ID, tagId: TAG_ID })
    ).resolves.toBeUndefined()
  })

  it('rejects a cross-tenant tag without deleting', async () => {
    vi.mocked(assertTagsBelongToTenant).mockRejectedValueOnce(new Error('Invalid tag IDs'))

    await expect(
      removeTagFromMember({ restaurantId: RESTAURANT_ID, memberId: MEMBER_ID, tagId: 't-x' })
    ).rejects.toThrow('Invalid tag IDs')
    expect(deleteMemberTag).not.toHaveBeenCalled()
  })

  it('rejects a cross-tenant member without deleting', async () => {
    vi.mocked(assertMemberBelongsToTenant).mockRejectedValueOnce(new Error('Invalid member ID'))

    await expect(
      removeTagFromMember({ restaurantId: RESTAURANT_ID, memberId: 'other', tagId: TAG_ID })
    ).rejects.toThrow('Invalid member ID')
    expect(deleteMemberTag).not.toHaveBeenCalled()
  })
})

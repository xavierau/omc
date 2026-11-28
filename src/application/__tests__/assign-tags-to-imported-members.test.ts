import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/member-tag-repository', () => ({
  assertTagsBelongToTenant: vi.fn(),
  upsertMemberTags: vi.fn(),
}))

import {
  assertTagsBelongToTenant,
  upsertMemberTags,
} from '@/infrastructure/supabase/repositories/member-tag-repository'
import { assignTagsToImportedMembers } from '../assign-tags-to-imported-members'

const RESTAURANT_ID = 'rest-1'

beforeEach(() => vi.clearAllMocks())

describe('assignTagsToImportedMembers', () => {
  it('asserts tags once then bulk-upserts the member×tag cross-product', async () => {
    await assignTagsToImportedMembers({
      restaurantId: RESTAURANT_ID,
      memberIds: ['m-1', 'm-2'],
      tagIds: ['t-1'],
    })

    expect(assertTagsBelongToTenant).toHaveBeenCalledTimes(1)
    expect(assertTagsBelongToTenant).toHaveBeenCalledWith(['t-1'], RESTAURANT_ID)
    expect(upsertMemberTags).toHaveBeenCalledWith(RESTAURANT_ID, ['m-1', 'm-2'], ['t-1'])
  })

  it('skips null/undefined member ids (consent-only rows)', async () => {
    await assignTagsToImportedMembers({
      restaurantId: RESTAURANT_ID,
      memberIds: ['m-1', null, undefined, 'm-2'],
      tagIds: ['t-1'],
    })

    expect(upsertMemberTags).toHaveBeenCalledWith(RESTAURANT_ID, ['m-1', 'm-2'], ['t-1'])
  })

  it('is a no-op when tagIds is empty (no assertion, no write)', async () => {
    await assignTagsToImportedMembers({
      restaurantId: RESTAURANT_ID,
      memberIds: ['m-1'],
      tagIds: [],
    })

    expect(assertTagsBelongToTenant).not.toHaveBeenCalled()
    expect(upsertMemberTags).not.toHaveBeenCalled()
  })

  it('is a no-op when every member id is null (no assertion, no write)', async () => {
    await assignTagsToImportedMembers({
      restaurantId: RESTAURANT_ID,
      memberIds: [null, null],
      tagIds: ['t-1'],
    })

    expect(assertTagsBelongToTenant).not.toHaveBeenCalled()
    expect(upsertMemberTags).not.toHaveBeenCalled()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import {
  setCampaignTags,
  CrossTenantTagError,
} from '@/application/set-campaign-tags'
import { CrossTenantTagError as RepoCrossTenantTagError } from '@/infrastructure/supabase/repositories/member-tag-repository'

const RESTAURANT_ID = 'rest-1'
const CAMPAIGN_ID = 'camp-1'

/**
 * Replays a Supabase builder sequence for campaign_tags writes:
 *   assert:  from('tags').select('id').eq('restaurant_id', x).in('id', ids)
 *   delete:  from('campaign_tags').delete().eq('campaign_id', id).eq('restaurant_id', x)
 *   upsert:  from('campaign_tags').upsert(rows, { onConflict, ignoreDuplicates })
 */
function buildClient(
  tagRows: { id: string }[] | null,
  tagError: { message: string } | null = null,
  upsertError: { message: string } | null = null,
  deleteError: { message: string } | null = null
) {
  const tagsIn = vi.fn().mockResolvedValue({ data: tagRows, error: tagError })
  const tagsEq = vi.fn().mockReturnValue({ in: tagsIn })
  const tagsSelect = vi.fn().mockReturnValue({ eq: tagsEq })

  const deleteEqs: Array<[string, string]> = []
  const deleteChain: Record<string, unknown> = {}
  deleteChain.eq = vi.fn((column: string, value: string) => {
    deleteEqs.push([column, value])
    return deleteChain
  })
  deleteChain.then = (onFulfilled: (v: unknown) => unknown) =>
    Promise.resolve({ error: deleteError }).then(onFulfilled)
  const deleteFn = vi.fn().mockReturnValue(deleteChain)

  const upsertFn = vi.fn(() => Promise.resolve({ error: upsertError }))

  const from = vi.fn((table: string) => {
    if (table === 'tags') return { select: tagsSelect }
    if (table === 'campaign_tags') return { delete: deleteFn, upsert: upsertFn }
    throw new Error(`unexpected table: ${table}`)
  })

  return { from, tagsIn, tagsEq, deleteFn, deleteEqs, upsertFn }
}

function useClient(m: ReturnType<typeof buildClient>) {
  vi.mocked(createServerSupabaseClient).mockReturnValue({ from: m.from } as never)
}

describe('setCampaignTags', () => {
  beforeEach(() => vi.clearAllMocks())

  it('replaces tags: deletes existing rows then upserts new rows incl. restaurant_id', async () => {
    const m = buildClient([{ id: 't-1' }, { id: 't-2' }])
    useClient(m)

    await setCampaignTags(CAMPAIGN_ID, ['t-1', 't-2'], RESTAURANT_ID)

    expect(m.deleteFn).toHaveBeenCalled()
    expect(m.upsertFn).toHaveBeenCalledWith(
      [
        { campaign_id: CAMPAIGN_ID, tag_id: 't-1', restaurant_id: RESTAURANT_ID },
        { campaign_id: CAMPAIGN_ID, tag_id: 't-2', restaurant_id: RESTAURANT_ID },
      ],
      { onConflict: 'campaign_id,tag_id', ignoreDuplicates: true }
    )
  })

  // Review round 2, finding 5: the service-role client bypasses RLS, so an
  // unscoped delete on a campaign id is one bad id away from clearing another
  // tenant's links.
  it('scopes the delete by restaurant_id as well as campaign_id', async () => {
    const m = buildClient([{ id: 't-1' }])
    useClient(m)

    await setCampaignTags(CAMPAIGN_ID, ['t-1'], RESTAURANT_ID)

    expect(m.deleteEqs).toEqual([
      ['campaign_id', CAMPAIGN_ID],
      ['restaurant_id', RESTAURANT_ID],
    ])
  })

  // A failed delete used to pass silently, leaving the OLD audience linked
  // while the campaign reported the new one.
  it('throws when the delete fails instead of inserting on top of stale links', async () => {
    const m = buildClient([{ id: 't-1' }], null, null, { message: 'delete blew up' })
    useClient(m)

    await expect(
      setCampaignTags(CAMPAIGN_ID, ['t-1'], RESTAURANT_ID)
    ).rejects.toThrow('delete blew up')
    expect(m.upsertFn).not.toHaveBeenCalled()
  })

  it('dedupes repeated tag ids before writing', async () => {
    const m = buildClient([{ id: 't-1' }])
    useClient(m)

    await setCampaignTags(CAMPAIGN_ID, ['t-1', 't-1', 't-1'], RESTAURANT_ID)

    expect(m.tagsIn).toHaveBeenCalledWith('id', ['t-1'])
    expect(m.upsertFn).toHaveBeenCalledWith(
      [{ campaign_id: CAMPAIGN_ID, tag_id: 't-1', restaurant_id: RESTAURANT_ID }],
      expect.anything()
    )
  })

  it('rejects a tag that belongs to a different tenant', async () => {
    // Only t-1 returned — t-2 belongs to another tenant
    const m = buildClient([{ id: 't-1' }])
    useClient(m)

    await expect(
      setCampaignTags(CAMPAIGN_ID, ['t-1', 't-2'], RESTAURANT_ID)
    ).rejects.toBeInstanceOf(CrossTenantTagError)
    // Cross-tenant tag must never be written.
    expect(m.upsertFn).not.toHaveBeenCalled()
  })

  it('rejects when none of the tagIds belong to the restaurant', async () => {
    const m = buildClient([])
    useClient(m)

    await expect(
      setCampaignTags(CAMPAIGN_ID, ['t-ghost'], RESTAURANT_ID)
    ).rejects.toBeInstanceOf(CrossTenantTagError)
  })

  it('clears the selection with empty tagIds (deletes, no tenant check, no upsert)', async () => {
    const m = buildClient([])
    useClient(m)

    await setCampaignTags(CAMPAIGN_ID, [], RESTAURANT_ID)

    expect(m.deleteFn).toHaveBeenCalled()
    expect(m.tagsIn).not.toHaveBeenCalled()
    expect(m.upsertFn).not.toHaveBeenCalled()
  })

  it('scopes the tenant-ownership query by restaurant_id', async () => {
    const m = buildClient([{ id: 't-1' }])
    useClient(m)

    await setCampaignTags(CAMPAIGN_ID, ['t-1'], RESTAURANT_ID)

    expect(m.tagsEq).toHaveBeenCalledWith('restaurant_id', RESTAURANT_ID)
    expect(m.tagsIn).toHaveBeenCalledWith('id', ['t-1'])
  })
})

describe('CrossTenantTagError', () => {
  // One class for both tag write paths (review round 2, finding 5) — the
  // campaign routes and the member-tag routes previously threw two different
  // classes of the same name with different status codes.
  it('is the same class the member-tag repository throws', () => {
    expect(CrossTenantTagError).toBe(RepoCrossTenantTagError)
  })

  it('carries a 403 status code for the API translator', () => {
    const err = new CrossTenantTagError('Invalid tag IDs')
    expect(err.statusCode).toBe(403)
    expect(err.message).toBe('Invalid tag IDs')
  })
})

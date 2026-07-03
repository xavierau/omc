import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import {
  setCampaignTags,
  CrossTenantTagError,
} from '@/application/set-campaign-tags'

const RESTAURANT_ID = 'rest-1'
const CAMPAIGN_ID = 'camp-1'

/**
 * Replays a Supabase builder sequence for campaign_tags writes:
 *   assert:  from('tags').select('id').eq('restaurant_id', x).in('id', ids)
 *   delete:  from('campaign_tags').delete().eq('campaign_id', id)
 *   insert:  from('campaign_tags').insert(rows)
 */
function buildClient(
  tagRows: { id: string }[] | null,
  tagError: { message: string } | null = null,
  insertError: { message: string } | null = null
) {
  const tagsIn = vi.fn().mockResolvedValue({ data: tagRows, error: tagError })
  const tagsEq = vi.fn().mockReturnValue({ in: tagsIn })
  const tagsSelect = vi.fn().mockReturnValue({ eq: tagsEq })

  const deleteEq = vi.fn().mockResolvedValue({ error: null })
  const deleteFn = vi.fn().mockReturnValue({ eq: deleteEq })

  const insertFn = vi.fn().mockResolvedValue({ error: insertError })

  const from = vi.fn((table: string) => {
    if (table === 'tags') return { select: tagsSelect }
    if (table === 'campaign_tags') return { delete: deleteFn, insert: insertFn }
    throw new Error(`unexpected table: ${table}`)
  })

  return { from, tagsIn, tagsEq, deleteFn, deleteEq, insertFn }
}

describe('setCampaignTags', () => {
  beforeEach(() => vi.clearAllMocks())

  it('replaces tags: deletes existing rows then inserts new rows incl. restaurant_id', async () => {
    const m = buildClient([{ id: 't-1' }, { id: 't-2' }])
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: m.from } as never)

    await setCampaignTags(CAMPAIGN_ID, ['t-1', 't-2'], RESTAURANT_ID)

    expect(m.deleteFn).toHaveBeenCalled()
    expect(m.deleteEq).toHaveBeenCalledWith('campaign_id', CAMPAIGN_ID)
    expect(m.insertFn).toHaveBeenCalledWith([
      { campaign_id: CAMPAIGN_ID, tag_id: 't-1', restaurant_id: RESTAURANT_ID },
      { campaign_id: CAMPAIGN_ID, tag_id: 't-2', restaurant_id: RESTAURANT_ID },
    ])
  })

  it('rejects a tag that belongs to a different tenant', async () => {
    // Only t-1 returned — t-2 belongs to another tenant
    const m = buildClient([{ id: 't-1' }])
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: m.from } as never)

    await expect(
      setCampaignTags(CAMPAIGN_ID, ['t-1', 't-2'], RESTAURANT_ID)
    ).rejects.toBeInstanceOf(CrossTenantTagError)
    // Cross-tenant tag must never be written.
    expect(m.insertFn).not.toHaveBeenCalled()
  })

  it('rejects when none of the tagIds belong to the restaurant', async () => {
    const m = buildClient([])
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: m.from } as never)

    await expect(
      setCampaignTags(CAMPAIGN_ID, ['t-ghost'], RESTAURANT_ID)
    ).rejects.toBeInstanceOf(CrossTenantTagError)
  })

  it('clears the selection with empty tagIds (deletes, no tenant check, no insert)', async () => {
    const m = buildClient([])
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: m.from } as never)

    await setCampaignTags(CAMPAIGN_ID, [], RESTAURANT_ID)

    expect(m.deleteFn).toHaveBeenCalled()
    expect(m.tagsIn).not.toHaveBeenCalled()
    expect(m.insertFn).not.toHaveBeenCalled()
  })

  it('scopes the tenant-ownership query by restaurant_id', async () => {
    const m = buildClient([{ id: 't-1' }])
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: m.from } as never)

    await setCampaignTags(CAMPAIGN_ID, ['t-1'], RESTAURANT_ID)

    expect(m.tagsEq).toHaveBeenCalledWith('restaurant_id', RESTAURANT_ID)
    expect(m.tagsIn).toHaveBeenCalledWith('id', ['t-1'])
  })
})

describe('CrossTenantTagError', () => {
  it('carries a 400 status code for the API translator', () => {
    const err = new CrossTenantTagError('Invalid tag IDs')
    expect(err.statusCode).toBe(400)
    expect(err.message).toBe('Invalid tag IDs')
  })
})

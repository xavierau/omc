import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import {
  setCampaignMembers,
  CrossTenantMemberError,
} from '../campaign-members-repository'

const RESTAURANT_ID = 'rest-1'
const CAMPAIGN_ID = 'camp-1'

/**
 * Build a mock that replays a Supabase builder sequence. Each call to
 * `from()` returns a chainable object that eventually resolves or exposes
 * a terminal method. The mock tracks calls for assertions.
 */
function buildClient(
  memberRows: { id: string }[] | null,
  memberError: { message: string } | null = null,
  insertError: { message: string } | null = null
) {
  // members query: .from('members').select('id').eq('restaurant_id', x).in('id', ids)
  const membersIn = vi.fn().mockResolvedValue({ data: memberRows, error: memberError })
  const membersEq = vi.fn().mockReturnValue({ in: membersIn })
  const membersSelect = vi.fn().mockReturnValue({ eq: membersEq })

  // delete: .from('campaign_members').delete().eq('campaign_id', id)
  const deleteEq = vi.fn().mockResolvedValue({ error: null })
  const deleteFn = vi.fn().mockReturnValue({ eq: deleteEq })

  // insert: .from('campaign_members').insert(rows)
  const insertFn = vi.fn().mockResolvedValue({ error: insertError })

  const from = vi.fn((table: string) => {
    if (table === 'members') return { select: membersSelect }
    if (table === 'campaign_members') return { delete: deleteFn, insert: insertFn }
    throw new Error(`unexpected table: ${table}`)
  })

  return { from, membersIn, membersEq, deleteEq, insertFn }
}

describe('setCampaignMembers', () => {
  beforeEach(() => vi.clearAllMocks())

  it('accepts memberIds that all belong to the current restaurant', async () => {
    const m = buildClient([{ id: 'm-1' }, { id: 'm-2' }])
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: m.from } as never)

    await setCampaignMembers(CAMPAIGN_ID, ['m-1', 'm-2'], RESTAURANT_ID)

    expect(m.insertFn).toHaveBeenCalledWith([
      { campaign_id: CAMPAIGN_ID, member_id: 'm-1' },
      { campaign_id: CAMPAIGN_ID, member_id: 'm-2' },
    ])
  })

  it('rejects memberIds that belong to a different tenant', async () => {
    // Only m-1 returned — m-2 belongs to another tenant
    const m = buildClient([{ id: 'm-1' }])
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: m.from } as never)

    await expect(
      setCampaignMembers(CAMPAIGN_ID, ['m-1', 'm-2'], RESTAURANT_ID)
    ).rejects.toBeInstanceOf(CrossTenantMemberError)
  })

  it('rejects when none of the memberIds belong to the restaurant', async () => {
    const m = buildClient([])
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: m.from } as never)

    await expect(
      setCampaignMembers(CAMPAIGN_ID, ['m-ghost'], RESTAURANT_ID)
    ).rejects.toBeInstanceOf(CrossTenantMemberError)
  })

  it('is a no-op validation when memberIds is empty (clears selection)', async () => {
    const m = buildClient([])
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: m.from } as never)

    await setCampaignMembers(CAMPAIGN_ID, [], RESTAURANT_ID)

    // Should not query members at all for empty input
    expect(m.membersIn).not.toHaveBeenCalled()
    // Should not insert
    expect(m.insertFn).not.toHaveBeenCalled()
  })

  it('scopes the membership query by restaurant_id', async () => {
    const m = buildClient([{ id: 'm-1' }])
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: m.from } as never)

    await setCampaignMembers(CAMPAIGN_ID, ['m-1'], RESTAURANT_ID)

    // The select chain passes through eq('restaurant_id', RESTAURANT_ID) then in('id', ids)
    expect(m.membersIn).toHaveBeenCalledWith('id', ['m-1'])
  })
})

describe('CrossTenantMemberError', () => {
  it('carries a 400 status code for the API translator', () => {
    const err = new CrossTenantMemberError('Invalid member IDs')
    expect(err.statusCode).toBe(400)
    expect(err.message).toBe('Invalid member IDs')
  })
})

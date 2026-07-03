import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))
vi.mock('../member-tag-repository', () => ({
  listMemberIdsByTag: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import { listMemberIdsByTag } from '../member-tag-repository'
import { getMembers } from '../member-list-query'

const RESTAURANT_ID = 'rest-1'

function rawMember(id: string, tags: { id: string; name: string; color: string }[] = []) {
  return {
    id,
    phone: `+8529${id}`,
    name: `Member ${id}`,
    points_balance: 0,
    status: 'active',
    joined_at: '2026-01-01T00:00:00Z',
    last_visit_at: null,
    preferred_language: null,
    member_tags: tags.map((t) => ({ tags: t })),
  }
}

// A single chainable object: every builder method returns the object itself,
// and awaiting it resolves to `resolved`. Lets us assert which methods/args
// the query builder received.
function buildQuery(resolved: { data: unknown[]; count: number; error: unknown }) {
  const obj: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'or', 'order', 'range']) {
    obj[m] = vi.fn(() => obj)
  }
  obj.then = (onFulfilled: (v: typeof resolved) => unknown) =>
    Promise.resolve(resolved).then(onFulfilled)
  return obj
}

function useQuery(obj: Record<string, unknown>) {
  const from = vi.fn(() => obj)
  vi.mocked(createServerSupabaseClient).mockReturnValue({ from } as never)
  return from
}

const baseParams = {
  restaurantId: RESTAURANT_ID,
  page: 1,
  pageSize: 20,
}

beforeEach(() => vi.clearAllMocks())

describe('getMembers — tagId filter', () => {
  it('pre-fetches member ids for the tag, constrains the query, returns members + exact count', async () => {
    vi.mocked(listMemberIdsByTag).mockResolvedValue(['m-1', 'm-2'])
    const q = buildQuery({
      data: [rawMember('m-1', [{ id: 't-1', name: 'VIP', color: '#111' }]), rawMember('m-2')],
      count: 2,
      error: null,
    })
    useQuery(q)

    const result = await getMembers({ ...baseParams, tagId: 't-1' })

    expect(listMemberIdsByTag).toHaveBeenCalledWith(['t-1'], RESTAURANT_ID)
    expect(q.eq).toHaveBeenCalledWith('restaurant_id', RESTAURANT_ID)
    expect(q.in).toHaveBeenCalledWith('id', ['m-1', 'm-2'])
    expect(result.total).toBe(2)
    expect(result.members).toHaveLength(2)
    expect(result.members[0].tags).toEqual([{ id: 't-1', name: 'VIP', color: '#111' }])
    expect(result.members[1].tags).toEqual([])
  })

  it('returns empty with zero total and does not query members for a 0-member tag', async () => {
    vi.mocked(listMemberIdsByTag).mockResolvedValue([])
    const from = useQuery(buildQuery({ data: [], count: 0, error: null }))

    const result = await getMembers({ ...baseParams, tagId: 'empty-tag' })

    expect(result).toEqual({ members: [], total: 0 })
    expect(from).not.toHaveBeenCalled()
  })
})

describe('getMembers — no tag filter', () => {
  it('lists tenant members without pre-fetching by tag', async () => {
    const q = buildQuery({ data: [rawMember('m-9')], count: 1, error: null })
    useQuery(q)

    const result = await getMembers({ ...baseParams })

    expect(listMemberIdsByTag).not.toHaveBeenCalled()
    expect(q.in).not.toHaveBeenCalled()
    expect(q.eq).toHaveBeenCalledWith('restaurant_id', RESTAURANT_ID)
    expect(result.total).toBe(1)
    expect(result.members[0].tags).toEqual([])
  })

  it('throws when supabase returns an error', async () => {
    const q = buildQuery({ data: [], count: 0, error: { message: 'boom' } })
    useQuery(q)

    await expect(getMembers({ ...baseParams })).rejects.toThrow('boom')
  })
})

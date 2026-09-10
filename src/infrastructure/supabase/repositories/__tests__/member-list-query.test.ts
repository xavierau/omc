import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
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
  it('filters with an aliased inner-join embed (no id pre-fetch) and keeps the exact count', async () => {
    const q = buildQuery({
      data: [rawMember('m-1', [{ id: 't-1', name: 'VIP', color: '#111' }]), rawMember('m-2')],
      count: 2,
      error: null,
    })
    useQuery(q)

    const result = await getMembers({ ...baseParams, tagId: 't-1' })

    // The join lives in the select string; the filter targets its alias.
    const [columns, options] = (q.select as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(columns).toContain('tag_filter:member_tags!inner(tag_id)')
    expect(options).toEqual({ count: 'exact' })
    expect(q.eq).toHaveBeenCalledWith('tag_filter.tag_id', 't-1')
    // Tenant predicate survives; no unbounded `.in('id', …)` list any more.
    expect(q.eq).toHaveBeenCalledWith('restaurant_id', RESTAURANT_ID)
    expect(q.in).not.toHaveBeenCalled()
    expect(result.total).toBe(2)
    expect(result.members).toHaveLength(2)
    expect(result.members[0].tags).toEqual([{ id: 't-1', name: 'VIP', color: '#111' }])
    expect(result.members[1].tags).toEqual([])
  })

  it('paginates and sorts the joined query exactly as the unfiltered one does', async () => {
    const q = buildQuery({ data: [], count: 0, error: null })
    useQuery(q)

    await getMembers({ ...baseParams, page: 3, pageSize: 20, tagId: 't-1', sortBy: 'name', sortOrder: 'asc' })

    expect(q.order).toHaveBeenCalledWith('name', { ascending: true, nullsFirst: false })
    expect(q.range).toHaveBeenCalledWith(40, 59)
  })

  it('returns empty with zero total for a 0-member tag (the join yields no rows)', async () => {
    const q = buildQuery({ data: [], count: 0, error: null })
    useQuery(q)

    const result = await getMembers({ ...baseParams, tagId: 'empty-tag' })

    expect(result).toEqual({ members: [], total: 0 })
  })

  it('drops the tag_filter join column from the returned member row', async () => {
    const q = buildQuery({
      data: [{ ...rawMember('m-1'), tag_filter: [{ tag_id: 't-1' }] }],
      count: 1,
      error: null,
    })
    useQuery(q)

    const result = await getMembers({ ...baseParams, tagId: 't-1' })

    expect(result.members[0]).not.toHaveProperty('tag_filter')
    expect(result.members[0].id).toBe('m-1')
  })
})

describe('getMembers — no tag filter', () => {
  it('lists tenant members without adding the tag join', async () => {
    const q = buildQuery({ data: [rawMember('m-9')], count: 1, error: null })
    useQuery(q)

    const result = await getMembers({ ...baseParams })

    const [columns] = (q.select as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(columns).not.toContain('!inner')
    expect(q.in).not.toHaveBeenCalled()
    expect(q.eq).toHaveBeenCalledWith('restaurant_id', RESTAURANT_ID)
    expect(q.eq).toHaveBeenCalledTimes(1)
    expect(result.total).toBe(1)
    expect(result.members[0].tags).toEqual([])
  })

  it('throws when supabase returns an error', async () => {
    const q = buildQuery({ data: [], count: 0, error: { message: 'boom' } })
    useQuery(q)

    await expect(getMembers({ ...baseParams })).rejects.toThrow('boom')
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import {
  assertTagsBelongToTenant,
  assertMemberBelongsToTenant,
  upsertMemberTags,
  deleteMemberTag,
  listTagsForMember,
  listMemberIdsByTag,
  CrossTenantTagError,
} from '../member-tag-repository'
import { CrossTenantMemberError } from '../campaign-members-repository'

const RESTAURANT_ID = 'rest-1'
const MEMBER_ID = 'mem-1'

// A chainable stub: eq()/in() return the same object (further chaining) and
// the object itself is awaitable, resolving to `resolved`. maybeSingle()/
// single() resolve directly. Mirrors the member-repository.test.ts approach.
function makeChain(resolved: unknown) {
  const obj: Record<string, unknown> = {}
  obj.eq = vi.fn(() => obj)
  obj.in = vi.fn(() => obj)
  obj.maybeSingle = vi.fn(() => Promise.resolve(resolved))
  obj.single = vi.fn(() => Promise.resolve(resolved))
  obj.then = (onFulfilled: (v: unknown) => unknown) =>
    Promise.resolve(resolved).then(onFulfilled)
  return obj
}

interface ClientConfig {
  tags?: { data?: { id: string }[] | null; error?: { message: string } | null }
  member?: { data?: { id: string } | null; error?: { message: string } | null }
  memberTagsSelect?: { data?: unknown[] | null; error?: { message: string } | null }
  upsertError?: { message: string } | null
  deleteError?: { message: string } | null
}

function buildClient(config: ClientConfig = {}) {
  const tagsChain = makeChain({
    data: config.tags?.data ?? [],
    error: config.tags?.error ?? null,
  })
  const memberChain = makeChain({
    data: config.member?.data ?? null,
    error: config.member?.error ?? null,
  })
  const mtSelectChain = makeChain({
    data: config.memberTagsSelect?.data ?? [],
    error: config.memberTagsSelect?.error ?? null,
  })
  const deleteChain = makeChain({ error: config.deleteError ?? null })

  const tagsSelect = vi.fn(() => tagsChain)
  const memberSelect = vi.fn(() => memberChain)
  const mtSelect = vi.fn(() => mtSelectChain)
  const upsertFn = vi.fn(() => Promise.resolve({ error: config.upsertError ?? null }))
  const deleteFn = vi.fn(() => deleteChain)

  const from = vi.fn((table: string) => {
    if (table === 'tags') return { select: tagsSelect }
    if (table === 'members') return { select: memberSelect }
    if (table === 'member_tags')
      return { select: mtSelect, upsert: upsertFn, delete: deleteFn }
    throw new Error(`unexpected table: ${table}`)
  })

  return {
    from,
    tagsSelect,
    tagsChain,
    memberSelect,
    memberChain,
    mtSelect,
    mtSelectChain,
    upsertFn,
    deleteFn,
    deleteChain,
  }
}

function useClient(c: ReturnType<typeof buildClient>) {
  vi.mocked(createServerSupabaseClient).mockReturnValue({ from: c.from } as never)
}

beforeEach(() => vi.clearAllMocks())

describe('assertTagsBelongToTenant', () => {
  it('passes when every tag id belongs to the tenant', async () => {
    const c = buildClient({ tags: { data: [{ id: 't-1' }, { id: 't-2' }] } })
    useClient(c)
    await expect(
      assertTagsBelongToTenant(['t-1', 't-2'], RESTAURANT_ID)
    ).resolves.toBeUndefined()
    expect(c.tagsChain.eq).toHaveBeenCalledWith('restaurant_id', RESTAURANT_ID)
    expect(c.tagsChain.in).toHaveBeenCalledWith('id', ['t-1', 't-2'])
  })

  it('rejects with CrossTenantTagError when a tag belongs to another tenant', async () => {
    const c = buildClient({ tags: { data: [{ id: 't-1' }] } })
    useClient(c)
    await expect(
      assertTagsBelongToTenant(['t-1', 't-2'], RESTAURANT_ID)
    ).rejects.toBeInstanceOf(CrossTenantTagError)
  })

  it('rejects when the tag id is unknown (no rows)', async () => {
    const c = buildClient({ tags: { data: [] } })
    useClient(c)
    await expect(
      assertTagsBelongToTenant(['ghost'], RESTAURANT_ID)
    ).rejects.toBeInstanceOf(CrossTenantTagError)
  })

  it('is a no-op for an empty tag list (does not query)', async () => {
    const c = buildClient()
    useClient(c)
    await assertTagsBelongToTenant([], RESTAURANT_ID)
    expect(c.tagsSelect).not.toHaveBeenCalled()
  })
})

describe('assertMemberBelongsToTenant', () => {
  it('passes when the member belongs to the tenant', async () => {
    const c = buildClient({ member: { data: { id: MEMBER_ID } } })
    useClient(c)
    await expect(
      assertMemberBelongsToTenant(MEMBER_ID, RESTAURANT_ID)
    ).resolves.toBeUndefined()
    expect(c.memberChain.eq).toHaveBeenCalledWith('restaurant_id', RESTAURANT_ID)
    expect(c.memberChain.eq).toHaveBeenCalledWith('id', MEMBER_ID)
  })

  it('rejects with CrossTenantMemberError when the member is not in the tenant', async () => {
    const c = buildClient({ member: { data: null } })
    useClient(c)
    await expect(
      assertMemberBelongsToTenant(MEMBER_ID, RESTAURANT_ID)
    ).rejects.toBeInstanceOf(CrossTenantMemberError)
  })
})

describe('upsertMemberTags', () => {
  it('builds the member×tag cross-product with restaurant_id and ignores duplicates', async () => {
    const c = buildClient()
    useClient(c)
    await upsertMemberTags(RESTAURANT_ID, ['m-1', 'm-2'], ['t-1', 't-2'])
    expect(c.upsertFn).toHaveBeenCalledWith(
      [
        { member_id: 'm-1', tag_id: 't-1', restaurant_id: RESTAURANT_ID },
        { member_id: 'm-1', tag_id: 't-2', restaurant_id: RESTAURANT_ID },
        { member_id: 'm-2', tag_id: 't-1', restaurant_id: RESTAURANT_ID },
        { member_id: 'm-2', tag_id: 't-2', restaurant_id: RESTAURANT_ID },
      ],
      { onConflict: 'member_id,tag_id', ignoreDuplicates: true }
    )
  })

  it('is a no-op when there are no members or no tags', async () => {
    const c = buildClient()
    useClient(c)
    await upsertMemberTags(RESTAURANT_ID, [], ['t-1'])
    await upsertMemberTags(RESTAURANT_ID, ['m-1'], [])
    expect(c.upsertFn).not.toHaveBeenCalled()
  })

  it('throws when supabase reports an error', async () => {
    const c = buildClient({ upsertError: { message: 'db down' } })
    useClient(c)
    await expect(
      upsertMemberTags(RESTAURANT_ID, ['m-1'], ['t-1'])
    ).rejects.toThrow('db down')
  })
})

describe('deleteMemberTag', () => {
  it('scopes the delete by member, tag and restaurant', async () => {
    const c = buildClient()
    useClient(c)
    await deleteMemberTag(MEMBER_ID, 't-1', RESTAURANT_ID)
    expect(c.deleteChain.eq).toHaveBeenCalledWith('member_id', MEMBER_ID)
    expect(c.deleteChain.eq).toHaveBeenCalledWith('tag_id', 't-1')
    expect(c.deleteChain.eq).toHaveBeenCalledWith('restaurant_id', RESTAURANT_ID)
  })
})

describe('listTagsForMember', () => {
  it('returns the mapped tags scoped to member + restaurant', async () => {
    const c = buildClient({
      memberTagsSelect: {
        data: [
          {
            tags: {
              id: 't-1',
              restaurant_id: RESTAURANT_ID,
              name: 'VIP',
              color: '#111111',
              created_at: '2026-01-01T00:00:00Z',
            },
          },
        ],
      },
    })
    useClient(c)
    const tags = await listTagsForMember(MEMBER_ID, RESTAURANT_ID)
    expect(tags).toEqual([
      {
        id: 't-1',
        restaurantId: RESTAURANT_ID,
        name: 'VIP',
        color: '#111111',
        createdAt: '2026-01-01T00:00:00Z',
      },
    ])
    expect(c.mtSelectChain.eq).toHaveBeenCalledWith('member_id', MEMBER_ID)
    expect(c.mtSelectChain.eq).toHaveBeenCalledWith('restaurant_id', RESTAURANT_ID)
  })
})

describe('listMemberIdsByTag', () => {
  it('returns deduped member ids for the given tags, tenant-scoped', async () => {
    const c = buildClient({
      memberTagsSelect: {
        data: [{ member_id: 'm-1' }, { member_id: 'm-2' }, { member_id: 'm-1' }],
      },
    })
    useClient(c)
    const ids = await listMemberIdsByTag(['t-1'], RESTAURANT_ID)
    expect(ids.sort()).toEqual(['m-1', 'm-2'])
    expect(c.mtSelectChain.eq).toHaveBeenCalledWith('restaurant_id', RESTAURANT_ID)
    expect(c.mtSelectChain.in).toHaveBeenCalledWith('tag_id', ['t-1'])
  })

  it('returns [] without querying for an empty tag list', async () => {
    const c = buildClient()
    useClient(c)
    const ids = await listMemberIdsByTag([], RESTAURANT_ID)
    expect(ids).toEqual([])
    expect(c.mtSelect).not.toHaveBeenCalled()
  })
})

describe('CrossTenantTagError', () => {
  it('carries a status code for the API translator', () => {
    const err = new CrossTenantTagError('Invalid tag IDs')
    expect(err.statusCode).toBe(403)
    expect(err.message).toBe('Invalid tag IDs')
  })
})

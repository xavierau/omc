import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import {
  assertMembersBelongToTenant,
  deleteMemberTagsBulk,
} from '../member-tag-bulk'
import { CrossTenantMemberError } from '../campaign-members-repository'

const RESTAURANT_ID = 'rest-1'

// Mirrors the chain stub in member-tag-repository.test.ts: eq()/in() return
// the same object for further chaining; select() after delete() resolves the
// deleted rows; the object itself is awaitable when no further select().
function makeChain(resolved: unknown) {
  const obj: Record<string, unknown> = {}
  obj.eq = vi.fn(() => obj)
  obj.in = vi.fn(() => obj)
  obj.select = vi.fn(() => Promise.resolve(resolved))
  obj.then = (onFulfilled: (v: unknown) => unknown) =>
    Promise.resolve(resolved).then(onFulfilled)
  return obj
}

interface ClientConfig {
  members?: { data?: { id: string }[] | null; error?: { message: string } | null }
  deleteResult?: { count?: number | null; error?: { message: string } | null }
}

function buildClient(config: ClientConfig = {}) {
  const membersChain = makeChain({
    data: config.members?.data ?? [],
    error: config.members?.error ?? null,
  })
  const deleteChain = makeChain({
    count: config.deleteResult?.count ?? 0,
    error: config.deleteResult?.error ?? null,
  })

  const membersSelect = vi.fn(() => membersChain)
  const deleteFn = vi.fn(() => deleteChain)

  const from = vi.fn((table: string) => {
    if (table === 'members') return { select: membersSelect }
    if (table === 'member_tags') return { delete: deleteFn }
    throw new Error(`unexpected table: ${table}`)
  })

  return { from, membersSelect, membersChain, deleteFn, deleteChain }
}

function useClient(c: ReturnType<typeof buildClient>) {
  vi.mocked(createServerSupabaseClient).mockReturnValue({ from: c.from } as never)
}

beforeEach(() => vi.clearAllMocks())

describe('assertMembersBelongToTenant', () => {
  it('passes when every member id belongs to the tenant', async () => {
    const c = buildClient({ members: { data: [{ id: 'm-1' }, { id: 'm-2' }] } })
    useClient(c)
    await expect(
      assertMembersBelongToTenant(['m-1', 'm-2'], RESTAURANT_ID)
    ).resolves.toBeUndefined()
    expect(c.membersChain.eq).toHaveBeenCalledWith('restaurant_id', RESTAURANT_ID)
    expect(c.membersChain.in).toHaveBeenCalledWith('id', ['m-1', 'm-2'])
  })

  it('rejects with CrossTenantMemberError when a member belongs to another tenant', async () => {
    const c = buildClient({ members: { data: [{ id: 'm-1' }] } })
    useClient(c)
    await expect(
      assertMembersBelongToTenant(['m-1', 'm-2'], RESTAURANT_ID)
    ).rejects.toBeInstanceOf(CrossTenantMemberError)
  })

  it('is a no-op for an empty member list (does not query)', async () => {
    const c = buildClient()
    useClient(c)
    await assertMembersBelongToTenant([], RESTAURANT_ID)
    expect(c.membersSelect).not.toHaveBeenCalled()
  })

  it('throws when supabase reports an error', async () => {
    const c = buildClient({ members: { error: { message: 'db down' } } })
    useClient(c)
    await expect(
      assertMembersBelongToTenant(['m-1'], RESTAURANT_ID)
    ).rejects.toThrow('db down')
  })
})

describe('deleteMemberTagsBulk', () => {
  it('scopes the delete by restaurant, member ids and tag ids and returns the row count', async () => {
    const c = buildClient({ deleteResult: { count: 2 } })
    useClient(c)
    const affected = await deleteMemberTagsBulk(RESTAURANT_ID, ['m-1', 'm-2'], ['t-1'])
    expect(affected).toBe(2)
    expect(c.deleteChain.eq).toHaveBeenCalledWith('restaurant_id', RESTAURANT_ID)
    expect(c.deleteChain.in).toHaveBeenCalledWith('member_id', ['m-1', 'm-2'])
    expect(c.deleteChain.in).toHaveBeenCalledWith('tag_id', ['t-1'])
  })

  it("asks PostgREST for an exact count instead of counting returned rows (I-5d)", async () => {
    const c = buildClient({ deleteResult: { count: 2500 } })
    useClient(c)

    // 2,500 pairs — above the max-rows cap that would truncate a returned
    // representation — still report exactly.
    const affected = await deleteMemberTagsBulk(RESTAURANT_ID, ['m-1'], ['t-1'])

    expect(affected).toBe(2500)
    expect(c.deleteFn).toHaveBeenCalledWith({ count: 'exact' })
    expect(c.deleteChain.select).not.toHaveBeenCalled()
  })

  it('returns 0 when no rows matched (not an error)', async () => {
    const c = buildClient({ deleteResult: { count: 0 } })
    useClient(c)
    const affected = await deleteMemberTagsBulk(RESTAURANT_ID, ['m-1'], ['t-x'])
    expect(affected).toBe(0)
  })

  it('returns 0 when PostgREST omits the count header', async () => {
    const c = buildClient({ deleteResult: { count: null } })
    useClient(c)
    expect(await deleteMemberTagsBulk(RESTAURANT_ID, ['m-1'], ['t-1'])).toBe(0)
  })

  it('is a no-op for empty member ids or empty tag ids (does not query)', async () => {
    const c = buildClient()
    useClient(c)
    expect(await deleteMemberTagsBulk(RESTAURANT_ID, [], ['t-1'])).toBe(0)
    expect(await deleteMemberTagsBulk(RESTAURANT_ID, ['m-1'], [])).toBe(0)
    expect(c.deleteFn).not.toHaveBeenCalled()
  })

  it('throws when supabase reports an error', async () => {
    const c = buildClient({ deleteResult: { error: { message: 'db down' } } })
    useClient(c)
    await expect(
      deleteMemberTagsBulk(RESTAURANT_ID, ['m-1'], ['t-1'])
    ).rejects.toThrow('db down')
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import { upsertMemberTagPairs, type MemberTagPair } from '../member-tag-pairs'

type UpsertRow = { member_id: string; tag_id: string; restaurant_id: string }
type UpsertOptions = { onConflict: string; ignoreDuplicates: boolean }

function buildClient(upsertError: { message: string } | null = null) {
  const upsert = vi.fn<
    (rows: UpsertRow[], options: UpsertOptions) => Promise<{ error: typeof upsertError }>
  >(() => Promise.resolve({ error: upsertError }))
  const deleteFn = vi.fn()
  const from = vi.fn((table: string) => {
    if (table !== 'member_tags') throw new Error(`unexpected table: ${table}`)
    return { upsert, delete: deleteFn }
  })
  vi.mocked(createServerSupabaseClient).mockReturnValue({ from } as never)
  return { from, upsert, deleteFn }
}

function pairs(count: number): MemberTagPair[] {
  return Array.from({ length: count }, (_, i) => ({
    memberId: `m-${i}`,
    tagId: 't-1',
  }))
}

describe('upsertMemberTagPairs', () => {
  beforeEach(() => vi.clearAllMocks())

  // T-B2.1: the exact (member, tag) pairs land, tenant-denormalised.
  it('writes member_id / tag_id / restaurant_id rows for each pair', async () => {
    const c = buildClient()

    await upsertMemberTagPairs('r-1', [
      { memberId: 'm-1', tagId: 't-vip' },
      { memberId: 'm-2', tagId: 't-lunch' },
    ])

    expect(c.upsert).toHaveBeenCalledTimes(1)
    expect(c.upsert.mock.calls[0][0]).toEqual([
      { member_id: 'm-1', tag_id: 't-vip', restaurant_id: 'r-1' },
      { member_id: 'm-2', tag_id: 't-lunch', restaurant_id: 'r-1' },
    ])
  })

  // T-B2.4: re-running the identical import must not error or duplicate.
  it('upserts on the (member_id, tag_id) PK ignoring duplicates', async () => {
    const c = buildClient()

    await upsertMemberTagPairs('r-1', [{ memberId: 'm-1', tagId: 't-1' }])

    expect(c.upsert.mock.calls[0][1]).toEqual({
      onConflict: 'member_id,tag_id',
      ignoreDuplicates: true,
    })
  })

  // T-B2.11
  it('chunks at 1000 pairs — 1200 pairs become 2 upserts of 1000 + 200', async () => {
    const c = buildClient()

    await upsertMemberTagPairs('r-1', pairs(1200))

    expect(c.upsert).toHaveBeenCalledTimes(2)
    expect(c.upsert.mock.calls[0][0].length).toBe(1000)
    expect(c.upsert.mock.calls[1][0].length).toBe(200)
  })

  it('sends exactly one upsert at the 1000-pair boundary', async () => {
    const c = buildClient()

    await upsertMemberTagPairs('r-1', pairs(1000))

    expect(c.upsert).toHaveBeenCalledTimes(1)
  })

  it('is a no-op for an empty pair list (no client, no write)', async () => {
    const c = buildClient()

    await upsertMemberTagPairs('r-1', [])

    expect(c.from).not.toHaveBeenCalled()
    expect(c.upsert).not.toHaveBeenCalled()
  })

  // A5 / invariant 1: import tagging is add-only.
  it('never issues a delete (import tagging is add-only)', async () => {
    const c = buildClient()

    await upsertMemberTagPairs('r-1', [{ memberId: 'm-1', tagId: 't-1' }])

    expect(c.deleteFn).not.toHaveBeenCalled()
  })

  it('throws when a chunk fails', async () => {
    buildClient({ message: 'member_tags down' })

    await expect(
      upsertMemberTagPairs('r-1', [{ memberId: 'm-1', tagId: 't-1' }])
    ).rejects.toThrow('member_tags down')
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({ createServerSupabaseClient: vi.fn() }))

import { createServerSupabaseClient } from '../../client'
import { clearMemberUnreachable } from '../member-quality-state'

const PREV = '2026-09-01T00:00:00.000Z'

function build(opts: { member: unknown; updated?: unknown[]; readError?: string }) {
  const calls = { select: [] as Array<[string, unknown]>, update: [] as Array<[string, unknown]>, patch: null as unknown }
  const readNode: Record<string, unknown> = {}
  readNode.eq = (c: string, v: unknown) => (calls.select.push([c, v]), readNode)
  readNode.not = (c: string) => (calls.select.push([`not:${c}`, null]), readNode)
  readNode.maybeSingle = async () => ({
    data: opts.member,
    error: opts.readError ? { message: opts.readError } : null,
  })
  const writeNode: Record<string, unknown> = {}
  writeNode.eq = (c: string, v: unknown) => (calls.update.push([c, v]), writeNode)
  writeNode.select = async () => ({ data: opts.updated ?? [], error: null })
  vi.mocked(createServerSupabaseClient).mockReturnValue({
    from: () => ({
      select: () => readNode,
      update: (p: unknown) => ((calls.patch = p), writeNode),
    }),
  } as never)
  return calls
}

describe('clearMemberUnreachable (MEM-004)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('scopes read and write by tenant, CAS on the previous value, and nulls only unreachable_at', async () => {
    const calls = build({ member: { id: 'm-1', unreachable_at: PREV }, updated: [{ id: 'm-1' }] })

    const out = await clearMemberUnreachable('r-1', '+85291234567')

    expect(out).toEqual({ memberId: 'm-1', previousUnreachableAt: PREV })
    expect(calls.select).toContainEqual(['restaurant_id', 'r-1'])
    expect(calls.update).toContainEqual(['restaurant_id', 'r-1'])
    expect(calls.update).toContainEqual(['id', 'm-1'])
    expect(calls.update).toContainEqual(['unreachable_at', PREV])
    expect(calls.patch).toEqual({ unreachable_at: null })
  })

  it('returns null when no unreachable member matches (unknown phone or already null)', async () => {
    build({ member: null })
    expect(await clearMemberUnreachable('r-1', '+85291234567')).toBeNull()
  })

  it('returns null when a concurrent writer changed the flag first (CAS matched no row)', async () => {
    build({ member: { id: 'm-1', unreachable_at: PREV }, updated: [] })
    expect(await clearMemberUnreachable('r-1', '+85291234567')).toBeNull()
  })

  it('throws on a read error so the use case can warn', async () => {
    build({ member: null, readError: 'boom' })
    await expect(clearMemberUnreachable('r-1', '+85291234567')).rejects.toThrow('boom')
  })
})

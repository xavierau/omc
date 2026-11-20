import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({ createServerSupabaseClient: vi.fn() }))

import { createServerSupabaseClient } from '../../client'
import { clearMemberUnreachable } from '../member-quality-state'

function build(opts: { updated?: unknown[]; error?: string }) {
  const calls = { from: [] as string[], eq: [] as Array<[string, unknown]>, not: [] as unknown[][], patch: null as unknown, select: 0 }
  const node: Record<string, unknown> = {}
  node.eq = (c: string, v: unknown) => (calls.eq.push([c, v]), node)
  node.not = (...a: unknown[]) => (calls.not.push(a), node)
  node.select = async () => (
    calls.select++,
    { data: opts.updated ?? [], error: opts.error ? { message: opts.error } : null }
  )
  const from = vi.fn((t: string) => {
    calls.from.push(t)
    return { update: (p: unknown) => ((calls.patch = p), node) }
  })
  vi.mocked(createServerSupabaseClient).mockReturnValue({ from } as never)
  return calls
}

describe('clearMemberUnreachable (MEM-004)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('issues exactly one conditional UPDATE (no select-first), scoped by tenant + phone', async () => {
    const calls = build({ updated: [{ id: 'm-1' }] })

    const out = await clearMemberUnreachable('r-1', '+85291234567')

    expect(out).toEqual({ memberId: 'm-1' })
    expect(calls.from).toEqual(['members'])
    expect(calls.patch).toEqual({ unreachable_at: null })
    expect(calls.eq).toEqual([['restaurant_id', 'r-1'], ['phone', '+85291234567']])
    expect(calls.not).toEqual([['unreachable_at', 'is', null]])
    expect(calls.select).toBe(1)
  })

  it('returns null when no row matched (unknown phone, already reachable, or a concurrent clear won)', async () => {
    build({ updated: [] })
    expect(await clearMemberUnreachable('r-1', '+85291234567')).toBeNull()
  })

  it('throws on a write error so the use case can warn', async () => {
    build({ error: 'boom' })
    await expect(clearMemberUnreachable('r-1', '+85291234567')).rejects.toThrow('boom')
  })
})

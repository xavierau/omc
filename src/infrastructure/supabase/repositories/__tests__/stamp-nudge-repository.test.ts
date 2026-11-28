import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import {
  getMemberNudgeState,
  claimNudgeSlot,
} from '../stamp-nudge-repository'

describe('getMemberNudgeState', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reads phone + quality flags for a member, tenant-scoped', async () => {
    const eqCalls: Array<[string, unknown]> = []
    const single = vi.fn().mockResolvedValue({
      data: {
        phone: '85291234567',
        preferred_language: 'en',
        pmm_throttled_until: '2026-07-01T00:00:00.000Z',
        unreachable_at: null,
      },
    })
    const eq = vi.fn().mockImplementation((col: string, val: unknown) => {
      eqCalls.push([col, val])
      return { eq, single }
    })
    const select = vi.fn().mockReturnValue({ eq })
    const from = vi.fn().mockReturnValue({ select })
    vi.mocked(createServerSupabaseClient).mockReturnValue({
      from,
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    const state = await getMemberNudgeState('m-1', 'r-1')

    expect(from).toHaveBeenCalledWith('members')
    expect(eqCalls).toContainEqual(['id', 'm-1'])
    expect(eqCalls).toContainEqual(['restaurant_id', 'r-1'])
    expect(state).toEqual({
      phone: '85291234567',
      preferredLanguage: 'en',
      pmmThrottledUntil: '2026-07-01T00:00:00.000Z',
      unreachableAt: null,
    })
  })

  it('returns null when the member is absent', async () => {
    const single = vi.fn().mockResolvedValue({ data: null })
    const chain: Record<string, unknown> = { single }
    chain.eq = vi.fn().mockReturnValue(chain)
    const select = vi.fn().mockReturnValue(chain)
    const from = vi.fn().mockReturnValue({ select })
    vi.mocked(createServerSupabaseClient).mockReturnValue({
      from,
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    expect(await getMemberNudgeState('m-x', 'r-1')).toBeNull()
  })
})

describe('claimNudgeSlot', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sets nudge_sent_at only when still NULL (atomic claim) and returns true on a claimed row', async () => {
    const eqCalls: Array<[string, unknown]> = []
    const isCalls: Array<[string, unknown]> = []
    const select = vi.fn().mockResolvedValue({ data: [{ id: 'card-1' }], error: null })
    const is = vi.fn().mockImplementation((col: string, val: unknown) => {
      isCalls.push([col, val])
      return { select }
    })
    const eq = vi.fn().mockImplementation((col: string, val: unknown) => {
      eqCalls.push([col, val])
      return { eq, is }
    })
    const update = vi.fn().mockReturnValue({ eq })
    const from = vi.fn().mockReturnValue({ update })
    vi.mocked(createServerSupabaseClient).mockReturnValue({
      from,
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    const claimed = await claimNudgeSlot('card-1')

    expect(from).toHaveBeenCalledWith('member_stamp_cards')
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ nudge_sent_at: expect.any(String) })
    )
    expect(eqCalls).toContainEqual(['id', 'card-1'])
    expect(isCalls).toContainEqual(['nudge_sent_at', null])
    expect(claimed).toBe(true)
  })

  it('returns false when the slot was already claimed (no rows updated)', async () => {
    const select = vi.fn().mockResolvedValue({ data: [], error: null })
    const is = vi.fn().mockReturnValue({ select })
    const chain: Record<string, unknown> = { is }
    chain.eq = vi.fn().mockReturnValue(chain)
    const update = vi.fn().mockReturnValue(chain)
    const from = vi.fn().mockReturnValue({ update })
    vi.mocked(createServerSupabaseClient).mockReturnValue({
      from,
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    expect(await claimNudgeSlot('card-1')).toBe(false)
  })

  it('throws when supabase returns an error', async () => {
    const select = vi.fn().mockResolvedValue({ data: null, error: { message: 'db down' } })
    const is = vi.fn().mockReturnValue({ select })
    const chain: Record<string, unknown> = { is }
    chain.eq = vi.fn().mockReturnValue(chain)
    const update = vi.fn().mockReturnValue(chain)
    const from = vi.fn().mockReturnValue({ update })
    vi.mocked(createServerSupabaseClient).mockReturnValue({
      from,
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    await expect(claimNudgeSlot('card-1')).rejects.toThrow('db down')
  })
})

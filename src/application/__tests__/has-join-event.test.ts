import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/client')

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { canClaimWelcome } from '../has-join-event'

const mockLimit = vi.fn()
const eqCalls: Array<[string, unknown]> = []
const chain = {
  eq: vi.fn((col: string, val: unknown) => {
    eqCalls.push([col, val])
    return chain
  }),
  limit: mockLimit,
}
const mockSelect = vi.fn().mockReturnValue(chain)
const mockFrom = vi.fn().mockReturnValue({ select: mockSelect })

describe('canClaimWelcome (WONB-020)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    eqCalls.length = 0
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: mockFrom } as never)
  })

  it('queries one join event scoped to restaurant + member', async () => {
    mockLimit.mockResolvedValueOnce({ data: [], error: null })

    await canClaimWelcome('rest-1', 'm-1')

    expect(mockFrom).toHaveBeenCalledWith('events')
    expect(eqCalls).toEqual([
      ['restaurant_id', 'rest-1'],
      ['member_id', 'm-1'],
      ['type', 'join'],
    ])
    expect(mockLimit).toHaveBeenCalledWith(1)
  })

  it('no join event -> claimable', async () => {
    mockLimit.mockResolvedValueOnce({ data: [], error: null })
    expect(await canClaimWelcome('rest-1', 'm-1')).toBe(true)
  })

  it('a join event exists -> not claimable', async () => {
    mockLimit.mockResolvedValueOnce({ data: [{ id: 'e-1' }], error: null })
    expect(await canClaimWelcome('rest-1', 'm-1')).toBe(false)
  })

  it('AC-5: a DB error -> not claimable, with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockLimit.mockResolvedValueOnce({ data: null, error: { message: 'connection reset' } })

    expect(await canClaimWelcome('rest-1', 'm-1')).toBe(false)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('join-event lookup failed'),
      expect.objectContaining({ message: expect.stringContaining('connection reset') })
    )
    warn.mockRestore()
  })
})

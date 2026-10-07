import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/client')

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { hasActiveRewards } from '../reward-repository'

function mockCountChain(result: { count: number | null; error: unknown }) {
  const eqActive = vi.fn().mockResolvedValue(result)
  const eqRestaurant = vi.fn().mockReturnValue({ eq: eqActive })
  const select = vi.fn().mockReturnValue({ eq: eqRestaurant })
  const from = vi.fn().mockReturnValue({ select })
  vi.mocked(createServerSupabaseClient).mockReturnValue({ from } as never)
  return { from, select, eqRestaurant, eqActive }
}

describe('hasActiveRewards', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns true when the restaurant has at least one active reward', async () => {
    const { from, select, eqActive } = mockCountChain({ count: 3, error: null })

    const result = await hasActiveRewards('restaurant-1')

    expect(result).toBe(true)
    expect(from).toHaveBeenCalledWith('rewards')
    expect(select).toHaveBeenCalledWith('id', { count: 'exact', head: true })
    expect(eqActive).toHaveBeenCalledWith('is_active', true)
  })

  it('returns false when the restaurant has zero active rewards', async () => {
    mockCountChain({ count: 0, error: null })

    expect(await hasActiveRewards('restaurant-1')).toBe(false)
  })

  it('returns false when count is null and there is no error', async () => {
    mockCountChain({ count: null, error: null })

    expect(await hasActiveRewards('restaurant-1')).toBe(false)
  })

  it('returns true on query error (do not hide a possibly-working option)', async () => {
    mockCountChain({ count: null, error: { message: 'boom' } })

    expect(await hasActiveRewards('restaurant-1')).toBe(true)
  })
})

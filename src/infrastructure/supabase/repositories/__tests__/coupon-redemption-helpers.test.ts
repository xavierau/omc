import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  aggregateRedemptionsByTenant,
  getRedemptionCountsByTenantForMonth,
} from '../coupon-redemption-repository'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'

describe('aggregateRedemptionsByTenant', () => {
  it('returns correct counts grouped by restaurant', () => {
    const rows = [
      { restaurant_id: 'r1' },
      { restaurant_id: 'r1' },
      { restaurant_id: 'r2' },
      { restaurant_id: 'r1' },
      { restaurant_id: 'r2' },
    ]

    const result = aggregateRedemptionsByTenant(rows)

    expect(result).toEqual([
      { restaurantId: 'r1', redemptionCount: 3 },
      { restaurantId: 'r2', redemptionCount: 2 },
    ])
  })

  it('returns empty array when no redemptions', () => {
    const result = aggregateRedemptionsByTenant([])
    expect(result).toEqual([])
  })

  it('handles multiple restaurants correctly', () => {
    const rows = [
      { restaurant_id: 'r1' },
      { restaurant_id: 'r2' },
      { restaurant_id: 'r3' },
      { restaurant_id: 'r2' },
      { restaurant_id: 'r3' },
      { restaurant_id: 'r3' },
    ]

    const result = aggregateRedemptionsByTenant(rows)

    expect(result).toHaveLength(3)
    expect(result).toContainEqual({ restaurantId: 'r1', redemptionCount: 1 })
    expect(result).toContainEqual({ restaurantId: 'r2', redemptionCount: 2 })
    expect(result).toContainEqual({ restaurantId: 'r3', redemptionCount: 3 })
  })

  it('handles single restaurant correctly', () => {
    const rows = [
      { restaurant_id: 'r1' },
      { restaurant_id: 'r1' },
    ]

    const result = aggregateRedemptionsByTenant(rows)

    expect(result).toEqual([
      { restaurantId: 'r1', redemptionCount: 2 },
    ])
  })
})

describe('getRedemptionCountsByTenantForMonth', () => {
  beforeEach(() => vi.clearAllMocks())

  function buildMock(rows: Array<{ restaurant_id: string }>, error: { message: string } | null = null) {
    const lt = vi.fn().mockResolvedValue({ data: rows, error })
    const gte = vi.fn().mockReturnValue({ lt })
    const eq = vi.fn().mockReturnValue({ gte })
    const select = vi.fn().mockReturnValue({ eq })
    const from = vi.fn().mockReturnValue({ select })
    return { from, select, eq, gte, lt }
  }

  it('filters redemptions to chargeable coupons only (welcome coupons excluded)', async () => {
    // Only the chargeable rows come back — the welcome-coupon redemption is
    // filtered out at the DB level by the is_chargeable=true predicate.
    const m = buildMock([{ restaurant_id: 'r1' }, { restaurant_id: 'r2' }])
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: m.from } as never)

    const result = await getRedemptionCountsByTenantForMonth(
      '2026-04-01T00:00:00Z',
      '2026-05-01T00:00:00Z'
    )

    expect(m.select).toHaveBeenCalledWith('restaurant_id, coupons!inner(is_chargeable)')
    expect(m.eq).toHaveBeenCalledWith('coupons.is_chargeable', true)
    expect(result).toEqual([
      { restaurantId: 'r1', redemptionCount: 1 },
      { restaurantId: 'r2', redemptionCount: 1 },
    ])
  })

  it('throws with a descriptive message when the query fails', async () => {
    const m = buildMock([], { message: 'boom' })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: m.from } as never)

    await expect(
      getRedemptionCountsByTenantForMonth('2026-04-01T00:00:00Z', '2026-05-01T00:00:00Z')
    ).rejects.toThrow('getRedemptionCountsByTenantForMonth: boom')
  })
})

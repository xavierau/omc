import { describe, it, expect } from 'vitest'
import { aggregateRedemptionsByTenant } from '../coupon-redemption-repository'

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

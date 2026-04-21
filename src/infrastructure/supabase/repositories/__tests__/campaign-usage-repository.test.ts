import { describe, it, expect } from 'vitest'
import { aggregateByTenant } from '../campaign-usage-repository'

describe('aggregateByTenant (billing aggregation)', () => {
  it('sums only chargeable_sent_count per restaurant', () => {
    const rows = [
      { restaurant_id: 'r1', chargeable_sent_count: 100 },
      { restaurant_id: 'r1', chargeable_sent_count: 50 },
      { restaurant_id: 'r2', chargeable_sent_count: 200 },
    ]

    const result = aggregateByTenant(rows)

    const r1 = result.find((r) => r.restaurantId === 'r1')!
    expect(r1.totalSent).toBe(150)
    expect(r1.campaignCount).toBe(2)

    const r2 = result.find((r) => r.restaurantId === 'r2')!
    expect(r2.totalSent).toBe(200)
    expect(r2.campaignCount).toBe(1)
  })

  it('ignores non-chargeable counters (welcome campaigns contribute 0)', () => {
    // A welcome campaign has chargeable_sent_count=0 even if many members
    // joined — its sends went into non_chargeable_sent_count (not selected).
    const rows = [
      { restaurant_id: 'r1', chargeable_sent_count: 0 },
      { restaurant_id: 'r1', chargeable_sent_count: 10 },
    ]

    const result = aggregateByTenant(rows)

    expect(result[0].totalSent).toBe(10)
    expect(result[0].campaignCount).toBe(2)
  })

  it('returns an empty array when no rows', () => {
    expect(aggregateByTenant([])).toEqual([])
  })
})

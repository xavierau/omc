import { describe, it, expect, vi, beforeEach } from 'vitest'
import { aggregateByTenant } from '../campaign-usage-repository'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import {
  getCampaignsForTenantMonth,
  getAllTenantsUsageForMonth,
} from '../campaign-usage-repository'

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

// Review round 2, item 5a: a 'failed' campaign is typically PARTIALLY
// sent (some members already got the chargeable message before the send
// exhausted retries) — billing must not silently drop that
// chargeable_sent_count just because the campaign never reached
// 'completed'.
interface QueryChainDouble {
  eq: (col: string, val: unknown) => QueryChainDouble
  in: (col: string, val: unknown) => QueryChainDouble
  gte: (col: string, val: unknown) => QueryChainDouble
  lt: (col: string, val: unknown) => QueryChainDouble
  order: (...args: unknown[]) => Promise<{ data: unknown; error: unknown }>
  // getAllTenantsUsageForMonth has no trailing .order() call — it awaits
  // the chain directly, so `then` must satisfy the native thenable shape.
  then: (resolve: (v: unknown) => unknown) => Promise<unknown>
}

function buildQueryChain(result: { data: unknown; error: unknown }) {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const record = (method: string, args: unknown[]): QueryChainDouble => {
    calls.push({ method, args })
    return chain
  }
  const chain: QueryChainDouble = {
    eq: (...args) => record('eq', args),
    in: (...args) => record('in', args),
    gte: (...args) => record('gte', args),
    lt: (...args) => record('lt', args),
    order: (...args) => {
      calls.push({ method: 'order', args })
      return Promise.resolve(result)
    },
    then: (resolve) => Promise.resolve(result).then(resolve),
  }
  return { chain, calls }
}

describe('getCampaignsForTenantMonth', () => {
  beforeEach(() => vi.clearAllMocks())

  it("includes 'failed' in the status filter", async () => {
    const { chain, calls } = buildQueryChain({ data: [], error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue({
      from: () => ({ select: () => chain }),
    } as never)

    await getCampaignsForTenantMonth('rest-1', '2026-01-01', '2026-02-01')

    const inCall = calls.find((c) => c.method === 'in')
    expect(inCall?.args).toEqual(['status', ['sending', 'completed', 'failed']])
  })
})

describe('getAllTenantsUsageForMonth', () => {
  beforeEach(() => vi.clearAllMocks())

  it("includes 'failed' in the status filter (billing must not drop a failed campaign's chargeable_sent_count)", async () => {
    const { chain, calls } = buildQueryChain({ data: [], error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue({
      from: () => ({ select: () => chain }),
    } as never)

    await getAllTenantsUsageForMonth('2026-01-01', '2026-02-01')

    const inCall = calls.find((c) => c.method === 'in')
    expect(inCall?.args).toEqual(['status', ['sending', 'completed', 'failed']])
  })
})

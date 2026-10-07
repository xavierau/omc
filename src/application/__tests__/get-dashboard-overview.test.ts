import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/client')

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { getDashboardOverview } from '../get-dashboard-overview'

function createChainable(overrides: Record<string, unknown> = {}) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  chain.limit = vi.fn().mockResolvedValue({ data: [], count: 0, ...overrides })
  chain.order = vi.fn().mockReturnValue({ limit: chain.limit })
  chain.gte = vi.fn().mockResolvedValue({ data: [], count: 0, ...overrides })
  chain.eq = vi.fn().mockImplementation(() => ({
    eq: chain.eq,
    gte: chain.gte,
    order: chain.order,
    ...({ data: [], count: 0, ...overrides }),
  }))
  chain.select = vi.fn().mockReturnValue({
    eq: chain.eq,
    ...({ data: [], count: 0, ...overrides }),
  })
  return chain
}

type TableChains = Record<string, ReturnType<typeof createChainable>>

function buildMockSupabase(tableChains: TableChains) {
  const callCounts: Record<string, number> = {}
  const mockFrom = vi.fn().mockImplementation((table: string) => {
    const key = callCounts[table]
      ? `${table}_${callCounts[table]}`
      : table
    callCounts[table] = (callCounts[table] ?? 0) + 1
    const chain = tableChains[key] ?? tableChains[table]
    return { select: chain?.select ?? vi.fn() }
  })
  return { from: mockFrom }
}

describe('getDashboardOverview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns correct aggregated overview with data', async () => {
    const members = createChainable({ count: 42 })
    const members_1 = createChainable({ count: 5 })
    const receipts = createChainable({
      data: [{ points_awarded: 100 }, { points_awarded: 50 }],
    })
    const campaigns = createChainable({ count: 3 })
    const coupons = createChainable({ count: 20 })
    const coupon_redemptions = createChainable({ count: 8 })
    const events = createChainable()
    events.limit.mockResolvedValue({
      data: [
        {
          id: 'e1',
          type: 'receipt',
          data_json: { amount: 100 },
          created_at: '2026-01-01T00:00:00Z',
          members: { name: 'Alice' },
        },
      ],
    })

    const mockSupabase = buildMockSupabase({
      members,
      members_1,
      receipts,
      campaigns,
      coupons,
      coupon_redemptions,
      events,
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(mockSupabase as never)

    const result = await getDashboardOverview('rest-1')

    expect(result.totalMembers).toBe(42)
    expect(result.newMembersToday).toBe(5)
    expect(result.totalPointsIssued).toBe(150)
    expect(result.activeCampaigns).toBe(3)
    expect(result.redemptionRate).toBe(40)
    expect(result.recentEvents).toHaveLength(1)
    expect(result.recentEvents[0].memberName).toBe('Alice')
    expect(result.recentEvents[0].type).toBe('receipt')
  })

  it('returns zeros when no data exists', async () => {
    const emptyChain = createChainable({ count: 0, data: [] })
    const mockSupabase = buildMockSupabase({
      members: emptyChain,
      members_1: createChainable({ count: 0 }),
      receipts: createChainable({ data: [] }),
      campaigns: emptyChain,
      coupons: createChainable({ count: 0 }),
      coupon_redemptions: emptyChain,
      events: createChainable(),
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(mockSupabase as never)

    const result = await getDashboardOverview('rest-1')

    expect(result.totalMembers).toBe(0)
    expect(result.newMembersToday).toBe(0)
    expect(result.totalPointsIssued).toBe(0)
    expect(result.activeCampaigns).toBe(0)
    expect(result.redemptionRate).toBe(0)
    expect(result.recentEvents).toEqual([])
  })

  it('extractMemberName handles array and object formats', async () => {
    const events = createChainable()
    events.limit.mockResolvedValue({
      data: [
        {
          id: 'e1',
          type: 'join',
          data_json: {},
          created_at: '2026-01-01T00:00:00Z',
          members: [{ name: 'Bob' }],
        },
        {
          id: 'e2',
          type: 'points',
          data_json: {},
          created_at: '2026-01-02T00:00:00Z',
          members: { name: 'Carol' },
        },
        {
          id: 'e3',
          type: 'redeem',
          data_json: {},
          created_at: '2026-01-03T00:00:00Z',
          members: null,
        },
      ],
    })

    const mockSupabase = buildMockSupabase({
      members: createChainable({ count: 0 }),
      members_1: createChainable({ count: 0 }),
      receipts: createChainable({ data: [] }),
      campaigns: createChainable({ count: 0 }),
      coupons: createChainable({ count: 0 }),
      coupon_redemptions: createChainable({ count: 0 }),
      events,
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(mockSupabase as never)

    const result = await getDashboardOverview('rest-1')

    expect(result.recentEvents[0].memberName).toBe('Bob')
    expect(result.recentEvents[1].memberName).toBe('Carol')
    expect(result.recentEvents[2].memberName).toBeNull()
  })
})

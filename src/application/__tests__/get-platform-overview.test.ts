import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/client')
vi.mock('@/infrastructure/supabase/repositories/restaurant-admin-repository')

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import {
  countByStatus,
  listAll,
} from '@/infrastructure/supabase/repositories/restaurant-admin-repository'
import { getPlatformOverview } from '../get-platform-overview'

function createCountChain(count: number, gteCount?: number) {
  const selectResult = {
    count,
    gte: vi.fn().mockResolvedValue({ count: gteCount ?? count }),
    eq: vi.fn().mockReturnThis(),
  }
  return {
    select: vi.fn().mockReturnValue(selectResult),
  }
}

describe('getPlatformOverview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('aggregates all counts and maps tenant list', async () => {
    vi.mocked(countByStatus).mockResolvedValue({
      active: 5,
      inactive: 2,
      trial: 3,
    })

    // members is called twice: total (select resolves directly) then recent (select.gte)
    const membersChain1 = createCountChain(100)
    const membersChain2 = createCountChain(0, 15)
    const receiptsChain = createCountChain(0, 50)
    const redemptionsChain = createCountChain(0, 20)
    const eventsChain = createCountChain(0, 200)

    const callIndex: Record<string, number> = {}
    const chainsByTable: Record<string, ReturnType<typeof createCountChain>[]> = {
      members: [membersChain1, membersChain2],
      receipts: [receiptsChain],
      coupon_redemptions: [redemptionsChain],
      events: [eventsChain],
    }

    const mockFrom = vi.fn().mockImplementation((table: string) => {
      callIndex[table] = callIndex[table] ?? 0
      const chains = chainsByTable[table] ?? [createCountChain(0)]
      const chain = chains[callIndex[table]] ?? chains[chains.length - 1]
      callIndex[table]++
      return { select: chain.select }
    })

    vi.mocked(createServerSupabaseClient).mockReturnValue({
      from: mockFrom,
    } as never)

    vi.mocked(listAll).mockResolvedValue({
      tenants: [
        {
          id: 't-1',
          name: 'Pizza Place',
          slug: 'pizza-place',
          status: 'active',
          member_count: 42,
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
      total: 1,
    } as never)

    const result = await getPlatformOverview()

    expect(result.totalTenants).toBe(10)
    expect(result.activeTenants).toBe(5)
    expect(result.inactiveTenants).toBe(2)
    expect(result.trialTenants).toBe(3)
    expect(result.totalMembers).toBe(100)
    expect(result.newMembers30d).toBe(15)
    expect(result.receiptsProcessed30d).toBe(50)
    expect(result.couponsRedeemed30d).toBe(20)
    expect(result.messagesSent30d).toBe(200)
    expect(result.recentTenants).toHaveLength(1)
    expect(result.recentTenants[0]).toEqual({
      id: 't-1',
      name: 'Pizza Place',
      slug: 'pizza-place',
      status: 'active',
      memberCount: 42,
      createdAt: '2026-01-01T00:00:00Z',
    })
  })

  it('returns zero values when counts are zero', async () => {
    vi.mocked(countByStatus).mockResolvedValue({
      active: 0,
      inactive: 0,
      trial: 0,
    })

    const zeroChain = createCountChain(0)
    const mockFrom = vi.fn().mockReturnValue({
      select: zeroChain.select,
    })

    vi.mocked(createServerSupabaseClient).mockReturnValue({
      from: mockFrom,
    } as never)

    vi.mocked(listAll).mockResolvedValue({
      tenants: [],
      total: 0,
    } as never)

    const result = await getPlatformOverview()

    expect(result.totalTenants).toBe(0)
    expect(result.activeTenants).toBe(0)
    expect(result.totalMembers).toBe(0)
    expect(result.newMembers30d).toBe(0)
    expect(result.receiptsProcessed30d).toBe(0)
    expect(result.couponsRedeemed30d).toBe(0)
    expect(result.messagesSent30d).toBe(0)
    expect(result.recentTenants).toEqual([])
  })
})

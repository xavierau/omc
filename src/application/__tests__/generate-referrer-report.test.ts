import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock(
  '@/infrastructure/supabase/repositories/campaign-usage-repository',
  () => ({ getAllTenantsUsageForMonth: vi.fn() })
)
vi.mock(
  '@/infrastructure/supabase/repositories/coupon-redemption-repository',
  () => ({ getRedemptionCountsByTenantForMonth: vi.fn() })
)
vi.mock(
  '@/infrastructure/supabase/repositories/restaurant-admin-repository',
  () => ({ listAllTenantsSummary: vi.fn() })
)
vi.mock(
  '@/infrastructure/supabase/repositories/referrer-repository',
  () => ({ listReferrers: vi.fn() })
)
vi.mock(
  '@/infrastructure/supabase/repositories/referrer-commission-repository',
  () => ({ upsertCommissions: vi.fn() })
)
vi.mock('@/lib/month-range', () => ({
  currentMonth: vi.fn(() => '2026-04'),
  parseMonthRange: vi.fn((m: string) => ({
    monthStart: `${m}-01T00:00:00.000Z`,
    monthEnd: `${m}-end`,
  })),
}))

import { generateReferrerReport } from '../generate-referrer-report'
import { getAllTenantsUsageForMonth } from '@/infrastructure/supabase/repositories/campaign-usage-repository'
import { getRedemptionCountsByTenantForMonth } from '@/infrastructure/supabase/repositories/coupon-redemption-repository'
import { listAllTenantsSummary } from '@/infrastructure/supabase/repositories/restaurant-admin-repository'
import { listReferrers } from '@/infrastructure/supabase/repositories/referrer-repository'
import { upsertCommissions } from '@/infrastructure/supabase/repositories/referrer-commission-repository'
import { currentMonth } from '@/lib/month-range'
import type { TenantSummary } from '@/infrastructure/supabase/repositories/restaurant-admin-repository'
import type { TenantUsageRow } from '@/infrastructure/supabase/repositories/campaign-usage-repository'
import type { TenantRedemptionRow } from '@/infrastructure/supabase/repositories/coupon-redemption-repository'
import type { Referrer } from '@/domain/entities/referrer'

const mockUsage = vi.mocked(getAllTenantsUsageForMonth)
const mockRedemptions = vi.mocked(getRedemptionCountsByTenantForMonth)
const mockTenants = vi.mocked(listAllTenantsSummary)
const mockReferrers = vi.mocked(listReferrers)
const mockUpsert = vi.mocked(upsertCommissions)

beforeEach(() => vi.clearAllMocks())

function buildTenant(o: Partial<TenantSummary> = {}): TenantSummary {
  return { id: 't1', name: 'Tenant 1', plan: 'starter', referrer_id: null, ...o }
}

function buildReferrer(o: Partial<Referrer> = {}): Referrer {
  return {
    id: 'ref-1', name: 'Referrer A', contactEmail: 'a@e.com',
    contactPhone: null, commissionPerMessageHkd: 0.05,
    commissionPerRedemptionHkd: 0.10,
    status: 'active', createdAt: '2026-01-01', updatedAt: '2026-01-01', ...o,
  }
}

function buildUsage(o: Partial<TenantUsageRow> = {}): TenantUsageRow {
  return { restaurantId: 't1', campaignCount: 1, totalSent: 100, ...o }
}

function buildRedemption(o: Partial<TenantRedemptionRow> = {}): TenantRedemptionRow {
  return { restaurantId: 't1', redemptionCount: 10, ...o }
}

describe('generateReferrerReport', () => {
  it('builds commission rows for referred tenants with broadcasts and redemptions', async () => {
    mockTenants.mockResolvedValue([
      buildTenant({ id: 't1', name: 'A', referrer_id: 'ref-1' }),
      buildTenant({ id: 't2', name: 'B', referrer_id: 'ref-2' }),
      buildTenant({ id: 't3', name: 'C', referrer_id: null }),
    ])
    mockReferrers.mockResolvedValue([
      buildReferrer({ id: 'ref-1', name: 'R1', commissionPerMessageHkd: 0.05, commissionPerRedemptionHkd: 0.2 }),
      buildReferrer({ id: 'ref-2', name: 'R2', commissionPerMessageHkd: 0.10, commissionPerRedemptionHkd: 0.5 }),
    ])
    mockUsage.mockResolvedValue([
      buildUsage({ restaurantId: 't1', totalSent: 200 }),
      buildUsage({ restaurantId: 't2', totalSent: 300 }),
    ])
    mockRedemptions.mockResolvedValue([
      buildRedemption({ restaurantId: 't1', redemptionCount: 5 }),
      buildRedemption({ restaurantId: 't2', redemptionCount: 2 }),
    ])
    mockUpsert.mockResolvedValue(undefined)

    const report = await generateReferrerReport('2026-04')

    expect(report.commissions).toHaveLength(2)
    expect(report.tenantsProcessed).toBe(2)
    expect(mockUpsert).toHaveBeenCalledOnce()
    expect(mockUpsert.mock.calls[0][0]).toHaveLength(2)
  })

  it('handles tenant with only broadcasts (0 redemptions)', async () => {
    mockTenants.mockResolvedValue([buildTenant({ id: 't1', name: 'A', referrer_id: 'ref-1' })])
    mockReferrers.mockResolvedValue([
      buildReferrer({ id: 'ref-1', commissionPerMessageHkd: 0.05, commissionPerRedemptionHkd: 0.2 }),
    ])
    mockUsage.mockResolvedValue([buildUsage({ restaurantId: 't1', totalSent: 200 })])
    mockRedemptions.mockResolvedValue([])
    mockUpsert.mockResolvedValue(undefined)

    const report = await generateReferrerReport('2026-04')

    expect(report.commissions).toHaveLength(1)
    const [row] = report.commissions
    expect(row.messagesSent).toBe(200)
    expect(row.redemptionsCount).toBe(0)
    expect(row.broadcastCommission).toBe(10)
    expect(row.redemptionCommission).toBe(0)
    expect(row.totalCommission).toBe(10)
    expect(report.totalBroadcastCommission).toBe(10)
    expect(report.totalRedemptionCommission).toBe(0)
    expect(report.totalCommission).toBe(10)
  })

  it('handles tenant with only redemptions (0 broadcasts)', async () => {
    mockTenants.mockResolvedValue([buildTenant({ id: 't1', name: 'A', referrer_id: 'ref-1' })])
    mockReferrers.mockResolvedValue([
      buildReferrer({ id: 'ref-1', commissionPerMessageHkd: 0.05, commissionPerRedemptionHkd: 0.2 }),
    ])
    mockUsage.mockResolvedValue([])
    mockRedemptions.mockResolvedValue([buildRedemption({ restaurantId: 't1', redemptionCount: 7 })])
    mockUpsert.mockResolvedValue(undefined)

    const report = await generateReferrerReport('2026-04')

    expect(report.commissions).toHaveLength(1)
    const [row] = report.commissions
    expect(row.messagesSent).toBe(0)
    expect(row.redemptionsCount).toBe(7)
    expect(row.broadcastCommission).toBe(0)
    expect(row.redemptionCommission).toBe(1.4)
    expect(row.totalCommission).toBe(1.4)
    expect(report.totalBroadcastCommission).toBe(0)
    expect(report.totalRedemptionCommission).toBe(1.4)
    expect(report.totalCommission).toBe(1.4)
  })

  it('handles tenant with both broadcasts and redemptions', async () => {
    mockTenants.mockResolvedValue([buildTenant({ id: 't1', name: 'A', referrer_id: 'ref-1' })])
    mockReferrers.mockResolvedValue([
      buildReferrer({ id: 'ref-1', commissionPerMessageHkd: 0.05, commissionPerRedemptionHkd: 0.2 }),
    ])
    mockUsage.mockResolvedValue([buildUsage({ restaurantId: 't1', totalSent: 100 })])
    mockRedemptions.mockResolvedValue([buildRedemption({ restaurantId: 't1', redemptionCount: 5 })])
    mockUpsert.mockResolvedValue(undefined)

    const report = await generateReferrerReport('2026-04')

    expect(report.commissions).toHaveLength(1)
    const [row] = report.commissions
    expect(row.broadcastCommission).toBe(5)
    expect(row.redemptionCommission).toBe(1)
    expect(row.totalCommission).toBe(6)
    expect(report.totalBroadcastCommission).toBe(5)
    expect(report.totalRedemptionCommission).toBe(1)
    expect(report.totalCommission).toBe(6)
  })

  it('skips tenants with 0 messages AND 0 redemptions', async () => {
    mockTenants.mockResolvedValue([buildTenant({ id: 't1', referrer_id: 'ref-1' })])
    mockReferrers.mockResolvedValue([buildReferrer({ id: 'ref-1' })])
    mockUsage.mockResolvedValue([buildUsage({ restaurantId: 't1', totalSent: 0 })])
    mockRedemptions.mockResolvedValue([])

    const report = await generateReferrerReport('2026-04')
    expect(report.commissions).toHaveLength(0)
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('skips tenants with no referrer_id', async () => {
    mockTenants.mockResolvedValue([buildTenant({ referrer_id: null })])
    mockReferrers.mockResolvedValue([buildReferrer()])
    mockUsage.mockResolvedValue([buildUsage()])
    mockRedemptions.mockResolvedValue([buildRedemption()])
    const report = await generateReferrerReport('2026-04')
    expect(report.commissions).toHaveLength(0)
  })

  it('skips tenants whose referrer is not found in map', async () => {
    mockTenants.mockResolvedValue([buildTenant({ id: 't1', referrer_id: 'ref-gone' })])
    mockReferrers.mockResolvedValue([buildReferrer({ id: 'ref-1' })])
    mockUsage.mockResolvedValue([buildUsage({ restaurantId: 't1', totalSent: 50 })])
    mockRedemptions.mockResolvedValue([buildRedemption({ restaurantId: 't1', redemptionCount: 3 })])
    const report = await generateReferrerReport('2026-04')
    expect(report.commissions).toHaveLength(0)
  })

  it('does not call upsertCommissions when no commissions', async () => {
    mockTenants.mockResolvedValue([])
    mockReferrers.mockResolvedValue([])
    mockUsage.mockResolvedValue([])
    mockRedemptions.mockResolvedValue([])
    const report = await generateReferrerReport('2026-04')
    expect(report.commissions).toEqual([])
    expect(report.totalCommission).toBe(0)
    expect(report.totalBroadcastCommission).toBe(0)
    expect(report.totalRedemptionCommission).toBe(0)
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('uses currentMonth when month param omitted', async () => {
    mockTenants.mockResolvedValue([])
    mockReferrers.mockResolvedValue([])
    mockUsage.mockResolvedValue([])
    mockRedemptions.mockResolvedValue([])
    const report = await generateReferrerReport()
    expect(report.month).toBe('2026-04')
    expect(currentMonth).toHaveBeenCalled()
  })

  it('calculates commission rounded to 2 decimals', async () => {
    mockTenants.mockResolvedValue([buildTenant({ id: 't1', name: 'A', referrer_id: 'ref-1' })])
    mockReferrers.mockResolvedValue([
      buildReferrer({ id: 'ref-1', commissionPerMessageHkd: 0.03, commissionPerRedemptionHkd: 0.07 }),
    ])
    mockUsage.mockResolvedValue([buildUsage({ restaurantId: 't1', totalSent: 7 })])
    mockRedemptions.mockResolvedValue([buildRedemption({ restaurantId: 't1', redemptionCount: 3 })])
    mockUpsert.mockResolvedValue(undefined)

    const report = await generateReferrerReport('2026-04')
    // broadcast: 7 * 0.03 = 0.21; redemption: 3 * 0.07 = 0.21; total: 0.42
    expect(report.commissions[0].broadcastCommission).toBe(0.21)
    expect(report.commissions[0].redemptionCommission).toBe(0.21)
    expect(report.commissions[0].totalCommission).toBe(0.42)
    expect(report.totalCommission).toBe(0.42)
  })

  it('upsert receives all dual-stream fields', async () => {
    mockTenants.mockResolvedValue([buildTenant({ id: 't1', name: 'A', referrer_id: 'ref-1' })])
    mockReferrers.mockResolvedValue([
      buildReferrer({ id: 'ref-1', commissionPerMessageHkd: 0.05, commissionPerRedemptionHkd: 0.2 }),
    ])
    mockUsage.mockResolvedValue([buildUsage({ restaurantId: 't1', totalSent: 100 })])
    mockRedemptions.mockResolvedValue([buildRedemption({ restaurantId: 't1', redemptionCount: 5 })])
    mockUpsert.mockResolvedValue(undefined)

    await generateReferrerReport('2026-04')

    expect(mockUpsert).toHaveBeenCalledOnce()
    const [inputs] = mockUpsert.mock.calls[0]
    expect(inputs).toHaveLength(1)
    expect(inputs[0]).toEqual({
      referrerId: 'ref-1',
      month: '2026-04',
      tenantId: 't1',
      tenantName: 'A',
      messagesSent: 100,
      redemptionsCount: 5,
      commissionPerMessage: 0.05,
      commissionPerRedemption: 0.2,
      broadcastCommission: 5,
      redemptionCommission: 1,
      totalCommission: 6,
    })
  })
})

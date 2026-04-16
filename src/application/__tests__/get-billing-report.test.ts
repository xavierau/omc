import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock(
  '@/infrastructure/supabase/repositories/campaign-usage-repository',
  () => ({
    getCampaignsForTenantMonth: vi.fn(),
    getAllTenantsUsageForMonth: vi.fn(),
  })
)

vi.mock(
  '@/infrastructure/supabase/repositories/restaurant-admin-repository',
  () => ({
    listAllTenantsSummary: vi.fn(),
  })
)

import { getBillingReport } from '../get-billing-report'
import { getAllTenantsUsageForMonth } from '@/infrastructure/supabase/repositories/campaign-usage-repository'
import { listAllTenantsSummary } from '@/infrastructure/supabase/repositories/restaurant-admin-repository'
import { estimateCampaignCost, toHKD } from '@/domain/services/campaign-cost'
import { calculateBroadcastFee } from '@/domain/services/platform-fee'

const mockGetAllUsage = vi.mocked(getAllTenantsUsageForMonth)
const mockListAll = vi.mocked(listAllTenantsSummary)

beforeEach(() => vi.clearAllMocks())

function makeTenant(id: string, name: string, plan: string) {
  return { id, name, plan, referrer_id: null }
}

describe('getBillingReport', () => {
  it('returns all tenants including zero-usage ones', async () => {
    mockListAll.mockResolvedValue([
      makeTenant('t1', 'Tenant A', 'starter'),
      makeTenant('t2', 'Tenant B', 'growth'),
      makeTenant('t3', 'Tenant C', 'pro'),
    ])
    mockGetAllUsage.mockResolvedValue([
      { restaurantId: 't1', campaignCount: 2, totalSent: 150 },
      { restaurantId: 't2', campaignCount: 1, totalSent: 300 },
    ])

    const report = await getBillingReport('2026-04')

    expect(report.month).toBe('2026-04')
    expect(report.tenants).toHaveLength(3)

    const t1 = report.tenants.find((t) => t.tenantId === 't1')!
    expect(t1.tenantName).toBe('Tenant A')
    expect(t1.plan).toBe('starter')
    expect(t1.campaignsRun).toBe(2)
    expect(t1.messagesSent).toBe(150)
    expect(t1.estimatedCostUsd).toBe(estimateCampaignCost(150))
    expect(t1.estimatedCostHkd).toBe(toHKD(estimateCampaignCost(150)))

    const t3 = report.tenants.find((t) => t.tenantId === 't3')!
    expect(t3.campaignsRun).toBe(0)
    expect(t3.messagesSent).toBe(0)
    expect(t3.estimatedCostUsd).toBe(0)
    expect(t3.estimatedCostHkd).toBe(0)
  })

  it('computes cost using estimateCampaignCost and toHKD', async () => {
    mockListAll.mockResolvedValue([
      makeTenant('t1', 'Tenant A', 'starter'),
    ])
    mockGetAllUsage.mockResolvedValue([
      { restaurantId: 't1', campaignCount: 1, totalSent: 500 },
    ])

    const report = await getBillingReport('2026-04')
    const row = report.tenants[0]

    const expectedUsd = estimateCampaignCost(500)
    const expectedHkd = toHKD(expectedUsd)
    expect(row.estimatedCostUsd).toBe(expectedUsd)
    expect(row.estimatedCostHkd).toBe(expectedHkd)
  })

  it('defaults to current month when not provided', async () => {
    mockListAll.mockResolvedValue([])
    mockGetAllUsage.mockResolvedValue([])

    const report = await getBillingReport()
    const now = new Date()
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

    expect(report.month).toBe(expected)
  })

  it('returns empty report when no tenants exist', async () => {
    mockListAll.mockResolvedValue([])
    mockGetAllUsage.mockResolvedValue([])

    const report = await getBillingReport('2026-04')

    expect(report.tenants).toEqual([])
    expect(report.totalMessages).toBe(0)
    expect(report.totalCostHkd).toBe(0)
    expect(report.totalRedemptions).toBe(0)
    expect(report.totalPlatformFeeHkd).toBe(0)
    expect(report.totalChargeHkd).toBe(0)
  })

  it('sums totals across all tenants', async () => {
    mockListAll.mockResolvedValue([
      makeTenant('t1', 'A', 'starter'),
      makeTenant('t2', 'B', 'growth'),
    ])
    mockGetAllUsage.mockResolvedValue([
      { restaurantId: 't1', campaignCount: 1, totalSent: 100 },
      { restaurantId: 't2', campaignCount: 2, totalSent: 200 },
    ])

    const report = await getBillingReport('2026-04')

    expect(report.totalMessages).toBe(300)
    const costT1 = toHKD(estimateCampaignCost(100))
    const costT2 = toHKD(estimateCampaignCost(200))
    expect(report.totalCostHkd).toBe(
      Math.round((costT1 + costT2) * 100) / 100
    )
  })

  it('includes platform fee fields on each tenant row', async () => {
    mockListAll.mockResolvedValue([
      makeTenant('t1', 'Tenant A', 'starter'),
    ])
    mockGetAllUsage.mockResolvedValue([
      { restaurantId: 't1', campaignCount: 1, totalSent: 100 },
    ])

    const report = await getBillingReport('2026-04')
    const row = report.tenants[0]

    const metaCost = toHKD(estimateCampaignCost(100))
    const broadcastFee = calculateBroadcastFee(100)

    expect(row.metaCostHkd).toBe(metaCost)
    expect(row.broadcastFeeHkd).toBe(broadcastFee)
    expect(row.redemptionsCount).toBe(0)
    expect(row.redemptionFeeHkd).toBe(0)
    expect(row.totalChargeHkd).toBe(
      Math.round((metaCost + broadcastFee) * 100) / 100
    )
  })

  it('computes report-level platform fee totals', async () => {
    mockListAll.mockResolvedValue([
      makeTenant('t1', 'A', 'starter'),
      makeTenant('t2', 'B', 'growth'),
    ])
    mockGetAllUsage.mockResolvedValue([
      { restaurantId: 't1', campaignCount: 1, totalSent: 100 },
      { restaurantId: 't2', campaignCount: 2, totalSent: 200 },
    ])

    const report = await getBillingReport('2026-04')

    expect(report.totalRedemptions).toBe(0)

    const expectedPlatformFee = calculateBroadcastFee(300)
    expect(report.totalPlatformFeeHkd).toBe(expectedPlatformFee)

    const metaTotal = report.totalCostHkd
    expect(report.totalChargeHkd).toBe(
      Math.round((metaTotal + expectedPlatformFee) * 100) / 100
    )
  })

  it('zero-usage tenant has zero platform fees', async () => {
    mockListAll.mockResolvedValue([
      makeTenant('t1', 'Tenant A', 'starter'),
    ])
    mockGetAllUsage.mockResolvedValue([])

    const report = await getBillingReport('2026-04')
    const row = report.tenants[0]

    expect(row.metaCostHkd).toBe(0)
    expect(row.broadcastFeeHkd).toBe(0)
    expect(row.redemptionsCount).toBe(0)
    expect(row.redemptionFeeHkd).toBe(0)
    expect(row.totalChargeHkd).toBe(0)
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock(
  '@/infrastructure/supabase/repositories/campaign-usage-repository',
  () => ({ getAllTenantsUsageForMonth: vi.fn() })
)
vi.mock(
  '@/infrastructure/supabase/repositories/restaurant-admin-repository',
  () => ({ listAllTenantsSummary: vi.fn() })
)
vi.mock(
  '@/infrastructure/supabase/repositories/referrer-repository',
  () => ({ listActiveReferrers: vi.fn() })
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
import { listAllTenantsSummary } from '@/infrastructure/supabase/repositories/restaurant-admin-repository'
import { listActiveReferrers } from '@/infrastructure/supabase/repositories/referrer-repository'
import { upsertCommissions } from '@/infrastructure/supabase/repositories/referrer-commission-repository'
import { currentMonth } from '@/lib/month-range'
import type { TenantSummary } from '@/infrastructure/supabase/repositories/restaurant-admin-repository'
import type { TenantUsageRow } from '@/infrastructure/supabase/repositories/campaign-usage-repository'
import type { Referrer } from '@/domain/entities/referrer'

const mockUsage = vi.mocked(getAllTenantsUsageForMonth)
const mockTenants = vi.mocked(listAllTenantsSummary)
const mockReferrers = vi.mocked(listActiveReferrers)
const mockUpsert = vi.mocked(upsertCommissions)

beforeEach(() => vi.clearAllMocks())

function buildTenant(o: Partial<TenantSummary> = {}): TenantSummary {
  return { id: 't1', name: 'Tenant 1', plan: 'starter', referrer_id: null, ...o }
}

function buildReferrer(o: Partial<Referrer> = {}): Referrer {
  return {
    id: 'ref-1', name: 'Referrer A', contactEmail: 'a@e.com',
    contactPhone: null, commissionPerMessageHkd: 0.05,
    status: 'active', createdAt: '2026-01-01', updatedAt: '2026-01-01', ...o,
  }
}

function buildUsage(o: Partial<TenantUsageRow> = {}): TenantUsageRow {
  return { restaurantId: 't1', campaignCount: 1, totalSent: 100, ...o }
}

describe('generateReferrerReport', () => {
  it('builds commission rows for referred tenants with usage', async () => {
    mockTenants.mockResolvedValue([
      buildTenant({ id: 't1', name: 'A', referrer_id: 'ref-1' }),
      buildTenant({ id: 't2', name: 'B', referrer_id: 'ref-2' }),
      buildTenant({ id: 't3', name: 'C', referrer_id: null }),
    ])
    mockReferrers.mockResolvedValue([
      buildReferrer({ id: 'ref-1', name: 'R1', commissionPerMessageHkd: 0.05 }),
      buildReferrer({ id: 'ref-2', name: 'R2', commissionPerMessageHkd: 0.10 }),
    ])
    mockUsage.mockResolvedValue([
      buildUsage({ restaurantId: 't1', totalSent: 200 }),
      buildUsage({ restaurantId: 't2', totalSent: 300 }),
    ])
    mockUpsert.mockResolvedValue(undefined)

    const report = await generateReferrerReport('2026-04')

    expect(report.commissions).toHaveLength(2)
    expect(report.tenantsProcessed).toBe(2)
    expect(mockUpsert).toHaveBeenCalledOnce()
    expect(mockUpsert.mock.calls[0][0]).toHaveLength(2)
  })

  it('skips tenants with no referrer_id', async () => {
    mockTenants.mockResolvedValue([buildTenant({ referrer_id: null })])
    mockReferrers.mockResolvedValue([buildReferrer()])
    mockUsage.mockResolvedValue([buildUsage()])
    const report = await generateReferrerReport('2026-04')
    expect(report.commissions).toHaveLength(0)
  })

  it('skips tenants whose referrer is not active', async () => {
    mockTenants.mockResolvedValue([
      buildTenant({ id: 't1', referrer_id: 'ref-gone' }),
    ])
    mockReferrers.mockResolvedValue([buildReferrer({ id: 'ref-1' })])
    mockUsage.mockResolvedValue([buildUsage({ restaurantId: 't1', totalSent: 50 })])
    const report = await generateReferrerReport('2026-04')
    expect(report.commissions).toHaveLength(0)
  })

  it('skips tenants with 0 messages', async () => {
    mockTenants.mockResolvedValue([
      buildTenant({ id: 't1', referrer_id: 'ref-1' }),
    ])
    mockReferrers.mockResolvedValue([buildReferrer({ id: 'ref-1' })])
    mockUsage.mockResolvedValue([buildUsage({ restaurantId: 't1', totalSent: 0 })])
    const report = await generateReferrerReport('2026-04')
    expect(report.commissions).toHaveLength(0)
  })

  it('does not call upsertCommissions when no commissions', async () => {
    mockTenants.mockResolvedValue([])
    mockReferrers.mockResolvedValue([])
    mockUsage.mockResolvedValue([])
    const report = await generateReferrerReport('2026-04')
    expect(report.commissions).toEqual([])
    expect(report.totalCommission).toBe(0)
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('uses currentMonth when month param omitted', async () => {
    mockTenants.mockResolvedValue([])
    mockReferrers.mockResolvedValue([])
    mockUsage.mockResolvedValue([])
    const report = await generateReferrerReport()
    expect(report.month).toBe('2026-04')
    expect(currentMonth).toHaveBeenCalled()
  })

  it('calculates commission rounded to 2 decimals', async () => {
    mockTenants.mockResolvedValue([
      buildTenant({ id: 't1', name: 'A', referrer_id: 'ref-1' }),
    ])
    mockReferrers.mockResolvedValue([
      buildReferrer({ id: 'ref-1', commissionPerMessageHkd: 0.03 }),
    ])
    mockUsage.mockResolvedValue([buildUsage({ restaurantId: 't1', totalSent: 7 })])
    mockUpsert.mockResolvedValue(undefined)

    const report = await generateReferrerReport('2026-04')
    // 7 * 0.03 = 0.21
    expect(report.commissions[0].totalCommission).toBe(0.21)
    expect(report.totalCommission).toBe(0.21)
  })
})

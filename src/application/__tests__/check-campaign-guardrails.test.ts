import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TenantCampaignSettings } from '@/domain/services/campaign-guardrails'

vi.mock(
  '@/infrastructure/supabase/repositories/campaign-settings-repository',
  () => ({
    getSettingsForTenant: vi.fn(),
    getMonthlyTenantSends: vi.fn(),
    getTodayCampaignCount: vi.fn(),
    getUnsubscribeStats: vi.fn(),
  })
)

import { checkCampaignGuardrails } from '../check-campaign-guardrails'
import {
  getSettingsForTenant,
  getMonthlyTenantSends,
  getTodayCampaignCount,
  getUnsubscribeStats,
} from '@/infrastructure/supabase/repositories/campaign-settings-repository'

const mockGetSettings = vi.mocked(getSettingsForTenant)
const mockMonthlySends = vi.mocked(getMonthlyTenantSends)
const mockDailyCount = vi.mocked(getTodayCampaignCount)
const mockUnsubStats = vi.mocked(getUnsubscribeStats)

const RESTAURANT_ID = 'rest-1'

function makeSettings(
  overrides: Partial<TenantCampaignSettings> = {}
): TenantCampaignSettings {
  return {
    restaurantId: RESTAURANT_ID,
    monthlySendLimit: 1000,
    dailyCampaignLimit: 3,
    maxUnsubscribeRate: 0.05,
    campaignPaused: false,
    perUserMarketingCap: 1,
    ...overrides,
  }
}

function setupMocks(opts: {
  settings?: TenantCampaignSettings | null
  monthlySends?: number
  dailyCount?: number
  unsubStats?: { total: number; unsubscribed: number }
} = {}) {
  mockGetSettings.mockResolvedValue(opts.settings ?? makeSettings())
  mockMonthlySends.mockResolvedValue(opts.monthlySends ?? 100)
  mockDailyCount.mockResolvedValue(opts.dailyCount ?? 0)
  mockUnsubStats.mockResolvedValue(
    opts.unsubStats ?? { total: 1000, unsubscribed: 10 }
  )
}

beforeEach(() => vi.clearAllMocks())

describe('checkCampaignGuardrails', () => {
  it('returns allowed when all checks pass', async () => {
    setupMocks()
    const result = await checkCampaignGuardrails(RESTAURANT_ID, 50)

    expect(result.allowed).toBe(true)
    expect(result.violations).toEqual([])
  })

  it('returns usage stats alongside result', async () => {
    setupMocks({
      monthlySends: 200,
      dailyCount: 1,
      unsubStats: { total: 500, unsubscribed: 5 },
    })
    const result = await checkCampaignGuardrails(RESTAURANT_ID, 50)

    expect(result.usage).toEqual({
      monthlySends: 200,
      monthlyLimit: 1000,
      dailyCampaigns: 1,
      dailyLimit: 3,
      unsubscribeRate: 0.01,
      maxUnsubscribeRate: 0.05,
    })
  })

  it('returns blocked when monthly limit exceeded', async () => {
    setupMocks({ monthlySends: 980 })
    const result = await checkCampaignGuardrails(RESTAURANT_ID, 50)

    expect(result.allowed).toBe(false)
    expect(result.violations.length).toBeGreaterThan(0)
    expect(result.violations[0]).toContain('Monthly send limit')
  })

  it('returns blocked when unsubscribe rate too high', async () => {
    setupMocks({ unsubStats: { total: 100, unsubscribed: 10 } })
    const result = await checkCampaignGuardrails(RESTAURANT_ID, 50)

    expect(result.allowed).toBe(false)
    expect(result.violations[0]).toContain('Unsubscribe rate')
  })

  it('returns blocked when campaign paused by admin', async () => {
    setupMocks({
      settings: makeSettings({
        campaignPaused: true,
        pausedReason: 'Abuse detected',
      }),
    })
    const result = await checkCampaignGuardrails(RESTAURANT_ID, 50)

    expect(result.allowed).toBe(false)
    expect(result.violations[0]).toContain('paused')
  })

  it('returns blocked when daily frequency exceeded', async () => {
    setupMocks({ dailyCount: 3 })
    const result = await checkCampaignGuardrails(RESTAURANT_ID, 50)

    expect(result.allowed).toBe(false)
    expect(result.violations[0]).toContain('Daily campaign limit')
  })

  it('returns multiple violations when multiple limits hit', async () => {
    setupMocks({
      settings: makeSettings({ campaignPaused: true }),
      monthlySends: 980,
      dailyCount: 3,
    })
    const result = await checkCampaignGuardrails(RESTAURANT_ID, 50)

    expect(result.allowed).toBe(false)
    expect(result.violations.length).toBeGreaterThanOrEqual(3)
  })

  it('uses default settings when no tenant settings exist', async () => {
    setupMocks({ settings: null, monthlySends: 10 })
    const result = await checkCampaignGuardrails(RESTAURANT_ID, 50)

    expect(result.allowed).toBe(true)
    expect(mockGetSettings).toHaveBeenCalledWith(RESTAURANT_ID)
  })

  it('includes warning when approaching monthly limit', async () => {
    setupMocks({ monthlySends: 850 })
    const result = await checkCampaignGuardrails(RESTAURANT_ID, 50)

    expect(result.allowed).toBe(true)
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings[0]).toContain('approaching')
  })
})

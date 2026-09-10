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

vi.mock(
  '@/infrastructure/supabase/repositories/restaurant-repository',
  () => ({
    getRestaurantPlan: vi.fn(),
  })
)

import { checkCampaignGuardrails } from '../check-campaign-guardrails'
import {
  getSettingsForTenant,
  getMonthlyTenantSends,
  getTodayCampaignCount,
  getUnsubscribeStats,
} from '@/infrastructure/supabase/repositories/campaign-settings-repository'
import { getRestaurantPlan } from '@/infrastructure/supabase/repositories/restaurant-repository'

const mockGetSettings = vi.mocked(getSettingsForTenant)
const mockMonthlySends = vi.mocked(getMonthlyTenantSends)
const mockDailyCount = vi.mocked(getTodayCampaignCount)
const mockUnsubStats = vi.mocked(getUnsubscribeStats)
const mockGetRestaurantPlan = vi.mocked(getRestaurantPlan)

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
    autoThrottleFactor: 1,
    autoPauseActive: false,
    autoPauseReason: null,
    autoPauseSetAt: null,
    pacingStrategy: 'engagement_tier',
    probeChunkSize: 100,
    scaleChunkSize: 100,
    activeHoursStartLocal: '10:00:00',
    activeHoursEndLocal: '22:00:00',
    tenantTimezone: 'Asia/Hong_Kong',
    ...overrides,
  }
}

function setupMocks(opts: {
  settings?: TenantCampaignSettings | null
  monthlySends?: number
  dailyCount?: number
  unsubStats?: { total: number; unsubscribed: number }
} = {}) {
  // #161: `opts.settings === undefined` (not provided) means "use the
  // default full row"; `opts.settings === null` (provided explicitly)
  // means "no tenant_campaign_settings row exists" and must reach
  // resolveSettings as null, not collapse into a default row via `??`.
  mockGetSettings.mockResolvedValue(
    opts.settings === undefined ? makeSettings() : opts.settings
  )
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
      autoThrottleFactor: 1,
      autoPauseActive: false,
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

  // WAQ-009: auto-throttle / auto-pause read paths.
  describe('WAQ-009 auto-throttle / auto-pause', () => {
    it('autoThrottleFactor=0.5 halves the effective daily limit', async () => {
      // dailyCampaignLimit=3 -> floor(3 * 0.5) = 1. dailyCount=1 should now block.
      setupMocks({
        settings: makeSettings({ autoThrottleFactor: 0.5 }),
        dailyCount: 1,
      })
      const result = await checkCampaignGuardrails(RESTAURANT_ID, 50)

      expect(result.allowed).toBe(false)
      expect(result.usage.dailyLimit).toBe(1)
      expect(result.usage.autoThrottleFactor).toBe(0.5)
    })

    it('autoThrottleFactor=0.5 halves the effective monthly limit', async () => {
      // monthlySendLimit=1000 -> floor(1000 * 0.5) = 500. With 480 sends + 50
      // target the new effective ceiling (500) is exceeded.
      setupMocks({
        settings: makeSettings({ autoThrottleFactor: 0.5 }),
        monthlySends: 480,
      })
      const result = await checkCampaignGuardrails(RESTAURANT_ID, 50)

      expect(result.allowed).toBe(false)
      expect(result.usage.monthlyLimit).toBe(500)
    })

    it('autoPauseActive=true denies regardless of count thresholds', async () => {
      // Plenty of headroom on every other axis — pure auto-pause denial.
      setupMocks({
        settings: makeSettings({
          autoPauseActive: true,
          autoPauseReason: 'quality_red_auto',
        }),
        monthlySends: 0,
        dailyCount: 0,
      })
      const result = await checkCampaignGuardrails(RESTAURANT_ID, 1)

      expect(result.allowed).toBe(false)
      expect(result.violations.some((v) => v.includes('auto-paused'))).toBe(true)
      expect(result.usage.autoPauseActive).toBe(true)
    })

    it('autoThrottleFactor=1.0 (no throttle) preserves stored limits', async () => {
      setupMocks({
        settings: makeSettings({ autoThrottleFactor: 1 }),
      })
      const result = await checkCampaignGuardrails(RESTAURANT_ID, 50)

      expect(result.usage.dailyLimit).toBe(3)
      expect(result.usage.monthlyLimit).toBe(1000)
      expect(result.usage.autoThrottleFactor).toBe(1)
    })

    it('manual pause and auto-pause both register as separate violations', async () => {
      setupMocks({
        settings: makeSettings({
          campaignPaused: true,
          pausedReason: 'manual ops',
          autoPauseActive: true,
          autoPauseReason: 'quality_red_auto',
        }),
      })
      const result = await checkCampaignGuardrails(RESTAURANT_ID, 50)

      expect(result.allowed).toBe(false)
      // Both gates fire — distinct messages so ops can see both reasons.
      expect(result.violations.length).toBeGreaterThanOrEqual(2)
    })
  })
})

// #161: resolveSettings falls back to a plan-derived limit (instead of the
// hardcoded starter default) when no tenant_campaign_settings row exists,
// and surfaces the fallback via a single console.warn.
describe('#161 resolveSettings plan-derived fallback', () => {
  it('derives the limit from restaurants.plan when no settings row exists (A3)', async () => {
    mockGetRestaurantPlan.mockResolvedValue('growth')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    setupMocks({ settings: null, monthlySends: 5000 })

    const result = await checkCampaignGuardrails(RESTAURANT_ID, 4000)

    expect(result.allowed).toBe(true)
    expect(result.usage.monthlyLimit).toBe(10000)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    const [message] = warnSpy.mock.calls[0]
    expect(message).toContain(RESTAURANT_ID)
    expect(message).toContain('plan=growth')
    expect(message).toContain('monthlySendLimit=10000')
    warnSpy.mockRestore()
  })

  it('falls back to starter when restaurants.plan lookup returns null (A4)', async () => {
    mockGetRestaurantPlan.mockResolvedValue(null)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    setupMocks({ settings: null })

    const result = await checkCampaignGuardrails(RESTAURANT_ID, 50)

    expect(result.usage.monthlyLimit).toBe(1000)
    expect(warnSpy.mock.calls[0][0]).toContain('plan=starter')
    warnSpy.mockRestore()
  })

  it('does not consult restaurants.plan or warn when a settings row exists (A5)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    setupMocks()

    await checkCampaignGuardrails(RESTAURANT_ID, 50)

    expect(mockGetRestaurantPlan).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('fails closed: a throwing plan lookup rejects the guardrail check (A6, D3)', async () => {
    mockGetRestaurantPlan.mockRejectedValue(new Error('db down'))
    setupMocks({ settings: null })

    await expect(
      checkCampaignGuardrails(RESTAURANT_ID, 50)
    ).rejects.toThrow('db down')
  })
})

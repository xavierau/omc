import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { DEFAULT_SETTINGS } from '@/domain/services/campaign-guardrails'
import type { TenantCampaignSettings } from '@/domain/services/campaign-guardrails'

vi.mock('@/infrastructure/supabase/guards/platform-admin-guard')
vi.mock('@/infrastructure/rate-limit/admin-rate-limit')
vi.mock(
  '@/infrastructure/supabase/repositories/campaign-settings-repository',
  () => ({
    getSettingsForTenant: vi.fn(),
    getMonthlyTenantSends: vi.fn(),
    getUnsubscribeStats: vi.fn(),
  })
)
vi.mock(
  '@/infrastructure/supabase/repositories/restaurant-repository',
  () => ({
    getRestaurantPlan: vi.fn(),
  })
)

import { assertPlatformAdmin } from '@/infrastructure/supabase/guards/platform-admin-guard'
import { checkAdminRateLimit } from '@/infrastructure/rate-limit/admin-rate-limit'
import {
  getSettingsForTenant,
  getMonthlyTenantSends,
  getUnsubscribeStats,
} from '@/infrastructure/supabase/repositories/campaign-settings-repository'
import { getRestaurantPlan } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { GET } from '../route'

const TENANT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

const mockGetSettings = vi.mocked(getSettingsForTenant)
const mockMonthlySends = vi.mocked(getMonthlyTenantSends)
const mockUnsubStats = vi.mocked(getUnsubscribeStats)
const mockGetRestaurantPlan = vi.mocked(getRestaurantPlan)

function req(): NextRequest {
  return new NextRequest(
    `http://localhost/api/admin/tenants/${TENANT_ID}/campaign-settings`
  )
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) }
}

function settingsRow(
  overrides: Partial<TenantCampaignSettings> = {}
): TenantCampaignSettings {
  return { restaurantId: TENANT_ID, ...DEFAULT_SETTINGS, ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(assertPlatformAdmin).mockResolvedValue({ userId: 'admin-1' })
  vi.mocked(checkAdminRateLimit).mockReturnValue({ success: true, remaining: 59 })
  mockMonthlySends.mockResolvedValue(0)
  mockUnsubStats.mockResolvedValue({ total: 0, unsubscribed: 0 })
})

/**
 * Review F2. When a tenant has no `tenant_campaign_settings` row this view
 * used to fall back to the hardcoded starter default (1,000), while the
 * guardrail that actually blocks the send resolved the tenant's PLAN quota
 * (#161). The two then disagreed about the same number, and an admin
 * "correcting" the view would PUT 1,000 and write the #161 bug into a real
 * row. Both sides now resolve through `planDerivedDefaults`.
 */
describe('GET /api/admin/tenants/[id]/campaign-settings — null-settings fallback', () => {
  it('reports a growth tenant with no settings row at its plan quota, not the starter default', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockGetSettings.mockResolvedValue(null)
    mockGetRestaurantPlan.mockResolvedValue('growth')

    const response = await GET(req(), ctx(TENANT_ID))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.settings.monthlySendLimit).toBe(10_000)
    expect(body.settings.restaurantId).toBe(TENANT_ID)
    expect(mockGetRestaurantPlan).toHaveBeenCalledWith(TENANT_ID)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    warnSpy.mockRestore()
  })

  it('computes the approaching-limit warning against the plan quota', async () => {
    // 9,000 of a growth tenant's 10,000 is a real warning; 9,000 against the
    // old hardcoded 1,000 denominator was a warning too -- but so was 900,
    // which is 9% of the quota the worker enforces.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockGetSettings.mockResolvedValue(null)
    mockGetRestaurantPlan.mockResolvedValue('growth')
    mockMonthlySends.mockResolvedValue(900)

    const response = await GET(req(), ctx(TENANT_ID))
    const body = await response.json()

    expect(body.warnings).toEqual([])
    warnSpy.mockRestore()
  })

  it('returns the stored row untouched when one exists, and never reads the plan', async () => {
    mockGetSettings.mockResolvedValue(settingsRow({ monthlySendLimit: 2_500 }))

    const response = await GET(req(), ctx(TENANT_ID))
    const body = await response.json()

    expect(body.settings.monthlySendLimit).toBe(2_500)
    expect(mockGetRestaurantPlan).not.toHaveBeenCalled()
  })
})

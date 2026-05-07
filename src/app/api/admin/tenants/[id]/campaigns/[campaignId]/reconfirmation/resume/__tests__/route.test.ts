import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/platform-admin-guard')
vi.mock('@/infrastructure/rate-limit/admin-rate-limit')
vi.mock('@/infrastructure/supabase/audit-logger', () => ({
  logAdminAction: vi.fn(),
  extractIp: vi.fn().mockReturnValue('1.2.3.4'),
}))
vi.mock('@/infrastructure/supabase/repositories/campaign-repository', async () => {
  const actual = await vi.importActual<
    typeof import('@/infrastructure/supabase/repositories/campaign-repository')
  >('@/infrastructure/supabase/repositories/campaign-repository')
  return {
    ...actual,
    getCampaignById: vi.fn(),
    transitionCampaignStatus: vi.fn(),
  }
})
vi.mock('@/infrastructure/supabase/repositories/campaign-settings-repository', () => ({
  getSettingsForTenant: vi.fn(),
  getReconfirmationDailyCap: vi.fn(),
  getReconfirmationSendsToday: vi.fn(),
  setReconfirmationDailyCap: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/quality-auto-flags', () => ({
  clearAutoQualityFlags: vi.fn(),
}))
vi.mock('@/application/check-reconfirmation-eligibility', () => ({
  checkReconfirmationEligibility: vi.fn(),
}))

import { assertPlatformAdmin } from '@/infrastructure/supabase/guards/platform-admin-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { checkAdminRateLimit } from '@/infrastructure/rate-limit/admin-rate-limit'
import { logAdminAction } from '@/infrastructure/supabase/audit-logger'
import {
  getCampaignById,
  transitionCampaignStatus,
} from '@/infrastructure/supabase/repositories/campaign-repository'
import { getSettingsForTenant } from '@/infrastructure/supabase/repositories/campaign-settings-repository'
import { clearAutoQualityFlags } from '@/infrastructure/supabase/repositories/quality-auto-flags'
import { checkReconfirmationEligibility } from '@/application/check-reconfirmation-eligibility'
import { POST } from '../route'
import type { Campaign } from '@/domain/entities/campaign'
import type { TenantCampaignSettings } from '@/domain/services/campaign-guardrails'

const TENANT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const CAMPAIGN_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

function req(): NextRequest {
  return new NextRequest(
    `http://localhost/api/admin/tenants/${TENANT_ID}/campaigns/${CAMPAIGN_ID}/reconfirmation/resume`,
    { method: 'POST' }
  )
}

function ctx(tid = TENANT_ID, cid = CAMPAIGN_ID) {
  return { params: Promise.resolve({ id: tid, campaignId: cid }) }
}

function buildCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: CAMPAIGN_ID,
    restaurantId: TENANT_ID,
    name: 'Re-confirmation',
    type: 'promo',
    template: '',
    templateEn: null,
    templateZhHk: null,
    imageUrlEn: null,
    imageUrlZhHk: null,
    couponConfig: null,
    schedule: null,
    scheduledAt: null,
    status: 'paused',
    mode: 'reconfirmation',
    isChargeable: true,
    chargeableSentCount: 0,
    nonChargeableSentCount: 0,
    redeemedCount: 0,
    whatsappTemplateId: 'tpl-utility-1',
    targetAudience: 'all',
    createdAt: '2026-04-25T00:00:00Z',
    ...overrides,
  }
}

function buildSettings(
  overrides: Partial<TenantCampaignSettings> = {}
): TenantCampaignSettings {
  return {
    restaurantId: TENANT_ID,
    monthlySendLimit: 1000,
    dailyCampaignLimit: 5,
    maxUnsubscribeRate: 0.05,
    campaignPaused: false,
    perUserMarketingCap: 1,
    autoThrottleFactor: 1,
    autoPauseActive: true,
    autoPauseReason: 'quality_yellow_throttle',
    autoPauseSetAt: new Date('2026-05-01T00:00:00Z'),
    pacingStrategy: 'engagement_tier',
    probeChunkSize: 100,
    scaleChunkSize: 100,
    activeHoursStartLocal: '09:00',
    activeHoursEndLocal: '21:00',
    tenantTimezone: 'Asia/Hong_Kong',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(assertPlatformAdmin).mockResolvedValue({ userId: 'admin-1' })
  vi.mocked(checkAdminRateLimit).mockReturnValue({ success: true, remaining: 59 })
  vi.mocked(getCampaignById).mockResolvedValue(buildCampaign())
  vi.mocked(getSettingsForTenant).mockResolvedValue(buildSettings())
  vi.mocked(checkReconfirmationEligibility).mockResolvedValue({
    allowed: true,
    violations: [],
    audienceCount: 30,
    currentDailySent: 0,
    cap: 50,
  })
  vi.mocked(clearAutoQualityFlags).mockResolvedValue(undefined)
  vi.mocked(transitionCampaignStatus).mockResolvedValue(true)
})

describe('POST /api/admin/tenants/[id]/campaigns/[campaignId]/reconfirmation/resume', () => {
  it('returns 401 when not signed in', async () => {
    vi.mocked(assertPlatformAdmin).mockRejectedValueOnce(new AuthError('Unauthorized', 401))
    const r = await POST(req(), ctx())
    expect(r.status).toBe(401)
  })

  it('returns 403 when caller is tenant-manager (not platform-admin)', async () => {
    vi.mocked(assertPlatformAdmin).mockRejectedValueOnce(
      new AuthError('Forbidden: not a platform admin', 403)
    )
    const r = await POST(req(), ctx())
    expect(r.status).toBe(403)
  })

  it('returns 429 when rate-limited', async () => {
    vi.mocked(checkAdminRateLimit).mockReturnValueOnce({ success: false, remaining: 0 })
    const r = await POST(req(), ctx())
    expect(r.status).toBe(429)
  })

  it('returns 400 for invalid tenant UUID', async () => {
    const r = await POST(req(), ctx('bad-id'))
    expect(r.status).toBe(400)
  })

  it('returns 400 for invalid campaign UUID', async () => {
    const r = await POST(req(), ctx(TENANT_ID, 'bad-id'))
    expect(r.status).toBe(400)
  })

  it('returns 404 when campaign is not found', async () => {
    vi.mocked(getCampaignById).mockResolvedValue(null)
    const r = await POST(req(), ctx())
    expect(r.status).toBe(404)
  })

  it('returns 404 when campaign belongs to a different tenant', async () => {
    vi.mocked(getCampaignById).mockResolvedValue(
      buildCampaign({ restaurantId: 'cccccccc-cccc-cccc-cccc-cccccccccccc' })
    )
    const r = await POST(req(), ctx())
    expect(r.status).toBe(404)
  })

  it('returns 404 when campaign mode is not reconfirmation', async () => {
    vi.mocked(getCampaignById).mockResolvedValue(buildCampaign({ mode: 'marketing' }))
    const r = await POST(req(), ctx())
    expect(r.status).toBe(404)
  })

  it('returns 400 when tenant is not currently auto-paused', async () => {
    vi.mocked(getSettingsForTenant).mockResolvedValue(
      buildSettings({ autoPauseActive: false })
    )
    const r = await POST(req(), ctx())
    expect(r.status).toBe(400)
    const body = await r.json()
    expect(body.reason).toBe('not_auto_paused')
  })

  it('returns 400 when eligibility re-check fails (still not GREEN-7d)', async () => {
    vi.mocked(checkReconfirmationEligibility).mockResolvedValue({
      allowed: false,
      violations: [{ key: 'quality_not_green', detail: 'YELLOW since 2026-05-04' }],
      audienceCount: 0,
      currentDailySent: 0,
      cap: 50,
    })
    const r = await POST(req(), ctx())
    expect(r.status).toBe(400)
    const body = await r.json()
    expect(body.reason).toBe('reconfirmation_not_allowed')
    expect(body.violations).toHaveLength(1)
    expect(clearAutoQualityFlags).not.toHaveBeenCalled()
  })

  it('returns 200 with { resumed: true, restartedAt } on success', async () => {
    const r = await POST(req(), ctx())
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.resumed).toBe(true)
    expect(typeof body.restartedAt).toBe('string')
    expect(clearAutoQualityFlags).toHaveBeenCalledWith(TENANT_ID)
  })

  it('flips the campaign status from paused → active on success', async () => {
    await POST(req(), ctx())
    expect(transitionCampaignStatus).toHaveBeenCalledWith(
      CAMPAIGN_ID,
      'paused',
      'active'
    )
  })

  it('returns 409 CAMPAIGN_NOT_PAUSED when campaign is not paused (e.g. already active)', async () => {
    vi.mocked(getCampaignById).mockResolvedValue(buildCampaign({ status: 'active' }))
    const r = await POST(req(), ctx())
    expect(r.status).toBe(409)
    const body = await r.json()
    expect(body.reason).toBe('CAMPAIGN_NOT_PAUSED')
    expect(clearAutoQualityFlags).not.toHaveBeenCalled()
    expect(transitionCampaignStatus).not.toHaveBeenCalled()
  })

  it('returns 409 CAMPAIGN_NOT_PAUSED when concurrent caller already flipped status (transition returns false)', async () => {
    vi.mocked(transitionCampaignStatus).mockResolvedValue(false)
    const r = await POST(req(), ctx())
    expect(r.status).toBe(409)
    const body = await r.json()
    expect(body.reason).toBe('CAMPAIGN_NOT_PAUSED')
  })

  it('writes a reconfirmation.resume audit log on success', async () => {
    await POST(req(), ctx())
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin-1',
        action: 'reconfirmation.resume',
        resourceType: 'campaign',
        resourceId: CAMPAIGN_ID,
      })
    )
  })

  it('returns 500 on unexpected error', async () => {
    vi.mocked(getCampaignById).mockRejectedValueOnce(new Error('boom'))
    const r = await POST(req(), ctx())
    expect(r.status).toBe(500)
  })
})

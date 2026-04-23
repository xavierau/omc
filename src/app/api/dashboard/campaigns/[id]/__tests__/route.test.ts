import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/infrastructure/supabase/repositories/campaign-repository', async () => {
  // Keep the real error class so `instanceof` checks in route.ts match
  // when tests simulate repository failures (mirrors POST test setup).
  const actual = await vi.importActual<
    typeof import('@/infrastructure/supabase/repositories/campaign-repository')
  >('@/infrastructure/supabase/repositories/campaign-repository')
  return {
    ...actual,
    getCampaignById: vi.fn(),
    updateCampaign: vi.fn(),
    setCampaignMembers: vi.fn(),
    getCampaignMemberIds: vi.fn(),
    remapWelcomeCampaign: vi.fn(),
  }
})
vi.mock('@/infrastructure/supabase/repositories/restaurant-onboarding-repository')

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import {
  getCampaignById,
  updateCampaign,
  setCampaignMembers,
  remapWelcomeCampaign,
  CampaignUniqueViolationError,
} from '@/infrastructure/supabase/repositories/campaign-repository'
import {
  getRestaurantDefaultLanguage,
  getOnboardingSettings,
} from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import { PATCH } from '../route'
import type { Campaign } from '@/domain/entities/campaign'

const RESTAURANT_ID = 'rest-1'
const CAMPAIGN_ID = 'camp-1'

function patchRequest(body: unknown): NextRequest {
  return new NextRequest(
    `http://localhost/api/dashboard/campaigns/${CAMPAIGN_ID}`,
    { method: 'PATCH', body: JSON.stringify(body) }
  )
}

function buildCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: CAMPAIGN_ID,
    restaurantId: RESTAURANT_ID,
    name: 'Name',
    type: 'promo',
    template: 'LEG',
    templateEn: null,
    templateZhHk: null,
    couponConfig: null,
    schedule: null,
    scheduledAt: null,
    status: 'draft',
    isChargeable: true,
    chargeableSentCount: 0,
    nonChargeableSentCount: 0,
    redeemedCount: 0,
    whatsappTemplateId: null,
    targetAudience: 'all',
    createdAt: '2026-04-20T00:00:00Z',
    ...overrides,
  }
}

describe('PATCH /api/dashboard/campaigns/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getTenantContext).mockResolvedValue({
      userId: 'u-1',
      restaurantId: RESTAURANT_ID,
      role: 'admin',
      tenantStatus: 'active',
    })
    vi.mocked(getCampaignById).mockResolvedValue(buildCampaign())
    vi.mocked(updateCampaign).mockResolvedValue(buildCampaign())
    vi.mocked(setCampaignMembers).mockResolvedValue(undefined)
    vi.mocked(getRestaurantDefaultLanguage).mockResolvedValue('zh_hk')
    vi.mocked(remapWelcomeCampaign).mockResolvedValue(undefined as never)
    vi.mocked(getOnboardingSettings).mockResolvedValue({
      welcomeCampaignId: null,
      returningMemberTemplate: null,
      returningMemberTemplateEn: null,
      returningMemberTemplateZhHk: null,
      defaultLanguage: 'zh_hk',
    })
  })

  it('accepts templateEn and templateZhHk changes', async () => {
    const r = await PATCH(
      patchRequest({ templateEn: 'Hi', templateZhHk: '你好' }),
      { params: Promise.resolve({ id: CAMPAIGN_ID }) }
    )
    expect(r.status).toBe(200)
    expect(updateCampaign).toHaveBeenCalledWith(
      CAMPAIGN_ID,
      expect.objectContaining({ templateEn: 'Hi', templateZhHk: '你好' })
    )
  })

  it('rejects oversize templateEn', async () => {
    const r = await PATCH(
      patchRequest({ templateEn: 'a'.repeat(1025) }),
      { params: Promise.resolve({ id: CAMPAIGN_ID }) }
    )
    expect(r.status).toBe(400)
  })

  it('rejects oversize templateZhHk', async () => {
    const r = await PATCH(
      patchRequest({ templateZhHk: 'a'.repeat(1025) }),
      { params: Promise.resolve({ id: CAMPAIGN_ID }) }
    )
    expect(r.status).toBe(400)
  })

  it('returns 403 for cross-tenant updates', async () => {
    vi.mocked(getCampaignById).mockResolvedValueOnce(
      buildCampaign({ restaurantId: 'other' })
    )
    const r = await PATCH(patchRequest({ templateEn: 'x' }), {
      params: Promise.resolve({ id: CAMPAIGN_ID }),
    })
    expect(r.status).toBe(403)
  })

  it('still accepts legacy template field', async () => {
    const r = await PATCH(
      patchRequest({ template: 'LegacyOnly' }),
      { params: Promise.resolve({ id: CAMPAIGN_ID }) }
    )
    expect(r.status).toBe(200)
    expect(updateCampaign).toHaveBeenCalledWith(
      CAMPAIGN_ID,
      expect.objectContaining({ template: 'LegacyOnly' })
    )
  })

  it('preserves zh_hk content in legacy template when admin edits only EN (default_language=zh_hk)', async () => {
    vi.mocked(getCampaignById).mockResolvedValueOnce(
      buildCampaign({
        template: '舊中文',
        templateEn: 'Old EN',
        templateZhHk: '舊中文',
      })
    )
    vi.mocked(getRestaurantDefaultLanguage).mockResolvedValueOnce('zh_hk')

    await PATCH(patchRequest({ templateEn: 'New EN' }), {
      params: Promise.resolve({ id: CAMPAIGN_ID }),
    })

    expect(updateCampaign).toHaveBeenCalledWith(
      CAMPAIGN_ID,
      expect.objectContaining({
        templateEn: 'New EN',
        legacyTemplate: '舊中文',
      })
    )
  })

  it('preserves EN content in legacy template when admin edits only zh_hk (default_language=en)', async () => {
    vi.mocked(getCampaignById).mockResolvedValueOnce(
      buildCampaign({
        template: 'Old EN',
        templateEn: 'Old EN',
        templateZhHk: '舊中文',
      })
    )
    vi.mocked(getRestaurantDefaultLanguage).mockResolvedValueOnce('en')

    await PATCH(patchRequest({ templateZhHk: '新中文' }), {
      params: Promise.resolve({ id: CAMPAIGN_ID }),
    })

    expect(updateCampaign).toHaveBeenCalledWith(
      CAMPAIGN_ID,
      expect.objectContaining({
        templateZhHk: '新中文',
        legacyTemplate: 'Old EN',
      })
    )
  })

  it('does not set legacyTemplate when no bilingual fields change', async () => {
    await PATCH(patchRequest({ name: 'Rename' }), {
      params: Promise.resolve({ id: CAMPAIGN_ID }),
    })

    const call = vi.mocked(updateCampaign).mock.calls[0][1]
    expect(call).not.toHaveProperty('legacyTemplate')
    expect(call).not.toHaveProperty('template')
  })

  it('passes restaurantId to setCampaignMembers for cross-tenant validation', async () => {
    await PATCH(
      patchRequest({ targetAudience: 'selected', memberIds: ['m-1'] }),
      { params: Promise.resolve({ id: CAMPAIGN_ID }) }
    )

    expect(setCampaignMembers).toHaveBeenCalledWith(
      CAMPAIGN_ID,
      ['m-1'],
      RESTAURANT_ID
    )
  })

  // Regression: the ALLOWED set dropped `type`, so the form's "welcome"
  // selection never reached the DB. Updating the type must now pass
  // through AND trigger the same auto-map cascade as POST.
  it('allows changing campaign type via PATCH (type: promo → welcome)', async () => {
    vi.mocked(getCampaignById).mockResolvedValueOnce(
      buildCampaign({ type: 'promo' })
    )
    vi.mocked(updateCampaign).mockResolvedValueOnce(
      buildCampaign({ type: 'welcome' })
    )
    vi.mocked(getOnboardingSettings).mockResolvedValueOnce({
      welcomeCampaignId: 'prev-welcome-9',
      returningMemberTemplate: null,
      returningMemberTemplateEn: null,
      returningMemberTemplateZhHk: null,
      defaultLanguage: 'zh_hk',
    })

    const r = await PATCH(patchRequest({ type: 'welcome' }), {
      params: Promise.resolve({ id: CAMPAIGN_ID }),
    })

    expect(r.status).toBe(200)
    expect(updateCampaign).toHaveBeenCalledWith(
      CAMPAIGN_ID,
      expect.objectContaining({ type: 'welcome' })
    )
    expect(remapWelcomeCampaign).toHaveBeenCalledWith(
      RESTAURANT_ID,
      'prev-welcome-9',
      CAMPAIGN_ID
    )
  })

  it('clears welcome mapping when the currently mapped welcome flips to another type', async () => {
    vi.mocked(getCampaignById).mockResolvedValueOnce(
      buildCampaign({ type: 'welcome' })
    )
    vi.mocked(updateCampaign).mockResolvedValueOnce(
      buildCampaign({ type: 'promo' })
    )
    vi.mocked(getOnboardingSettings).mockResolvedValueOnce({
      welcomeCampaignId: CAMPAIGN_ID,
      returningMemberTemplate: null,
      returningMemberTemplateEn: null,
      returningMemberTemplateZhHk: null,
      defaultLanguage: 'zh_hk',
    })

    const r = await PATCH(patchRequest({ type: 'promo' }), {
      params: Promise.resolve({ id: CAMPAIGN_ID }),
    })

    expect(r.status).toBe(200)
    expect(remapWelcomeCampaign).toHaveBeenCalledWith(
      RESTAURANT_ID,
      CAMPAIGN_ID,
      null
    )
  })

  it('skips cascade when an un-mapped welcome campaign flips to another type', async () => {
    vi.mocked(getCampaignById).mockResolvedValueOnce(
      buildCampaign({ type: 'welcome' })
    )
    vi.mocked(updateCampaign).mockResolvedValueOnce(
      buildCampaign({ type: 'promo' })
    )
    vi.mocked(getOnboardingSettings).mockResolvedValueOnce({
      welcomeCampaignId: 'other-campaign-id',
      returningMemberTemplate: null,
      returningMemberTemplateEn: null,
      returningMemberTemplateZhHk: null,
      defaultLanguage: 'zh_hk',
    })

    const r = await PATCH(patchRequest({ type: 'promo' }), {
      params: Promise.resolve({ id: CAMPAIGN_ID }),
    })

    expect(r.status).toBe(200)
    expect(remapWelcomeCampaign).not.toHaveBeenCalled()
  })

  it('returns 409 when changing type to welcome violates the partial unique index', async () => {
    vi.mocked(getCampaignById).mockResolvedValueOnce(
      buildCampaign({ type: 'promo' })
    )
    vi.mocked(updateCampaign).mockRejectedValueOnce(
      new CampaignUniqueViolationError(
        'idx_campaigns_one_active_welcome_per_restaurant',
        'duplicate key value violates unique constraint'
      )
    )

    const r = await PATCH(patchRequest({ type: 'welcome' }), {
      params: Promise.resolve({ id: CAMPAIGN_ID }),
    })

    expect(r.status).toBe(409)
    const body = await r.json()
    expect(body.error).toContain('welcome campaign already exists')
    expect(remapWelcomeCampaign).not.toHaveBeenCalled()
  })

  it('does not block the 200 response when remapWelcomeCampaign fails (best-effort cascade)', async () => {
    vi.mocked(getCampaignById).mockResolvedValueOnce(
      buildCampaign({ type: 'promo' })
    )
    vi.mocked(updateCampaign).mockResolvedValueOnce(
      buildCampaign({ type: 'welcome' })
    )
    vi.mocked(remapWelcomeCampaign).mockRejectedValueOnce(new Error('rpc down'))

    const r = await PATCH(patchRequest({ type: 'welcome' }), {
      params: Promise.resolve({ id: CAMPAIGN_ID }),
    })

    expect(r.status).toBe(200)
  })

  it('does not call remapWelcomeCampaign when the type is unchanged', async () => {
    vi.mocked(getCampaignById).mockResolvedValueOnce(
      buildCampaign({ type: 'promo' })
    )

    await PATCH(patchRequest({ name: 'Rename only' }), {
      params: Promise.resolve({ id: CAMPAIGN_ID }),
    })

    expect(remapWelcomeCampaign).not.toHaveBeenCalled()
  })
})

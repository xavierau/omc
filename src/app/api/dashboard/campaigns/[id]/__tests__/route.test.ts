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
    imageUrlEn: null,
    imageUrlZhHk: null,
    couponConfig: null,
    schedule: null,
    scheduledAt: null,
    status: 'draft',
    mode: 'marketing',
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
    // mockReset() clears both recorded calls AND queued `mockResolvedValueOnce`
    // values — critical because unconsumed `…Once` queues leak across tests
    // and silently feed the wrong value to the next test's cascade.
    vi.mocked(getCampaignById).mockReset()
    vi.mocked(updateCampaign).mockReset()
    vi.mocked(setCampaignMembers).mockReset()
    vi.mocked(remapWelcomeCampaign).mockReset()
    vi.mocked(getOnboardingSettings).mockReset()
    vi.mocked(getRestaurantDefaultLanguage).mockReset()
    vi.mocked(getTenantContext).mockReset()
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
  // through AND trigger the same auto-map cascade as POST. Status must
  // be active for the guard to permit the auto-map.
  it('allows changing campaign type via PATCH (type: promo → welcome)', async () => {
    vi.mocked(getCampaignById).mockResolvedValueOnce(
      buildCampaign({ type: 'promo', status: 'active' })
    )
    vi.mocked(updateCampaign).mockResolvedValueOnce(
      buildCampaign({ type: 'welcome', status: 'active' })
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
    expect(getOnboardingSettings).toHaveBeenCalledWith(RESTAURANT_ID)
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
    expect(getOnboardingSettings).toHaveBeenCalledWith(RESTAURANT_ID)
    expect(remapWelcomeCampaign).not.toHaveBeenCalled()
  })

  // Guard: when PATCH sets type=welcome but the patch body itself
  // pauses the campaign (or it was already paused/draft), we must NOT
  // auto-map it as the active welcome — otherwise new members route to
  // a paused campaign. The type change still persists.
  it('skips auto-map when PATCH flips type → welcome AND sets status=paused', async () => {
    vi.mocked(getCampaignById).mockResolvedValueOnce(
      buildCampaign({ type: 'promo', status: 'active' })
    )
    vi.mocked(updateCampaign).mockResolvedValueOnce(
      buildCampaign({ type: 'welcome', status: 'paused' })
    )
    vi.mocked(getOnboardingSettings).mockResolvedValueOnce({
      welcomeCampaignId: 'prev-welcome-9',
      returningMemberTemplate: null,
      returningMemberTemplateEn: null,
      returningMemberTemplateZhHk: null,
      defaultLanguage: 'zh_hk',
    })

    const r = await PATCH(
      patchRequest({ type: 'welcome', status: 'paused' }),
      { params: Promise.resolve({ id: CAMPAIGN_ID }) }
    )

    expect(r.status).toBe(200)
    expect(updateCampaign).toHaveBeenCalledWith(
      CAMPAIGN_ID,
      expect.objectContaining({ type: 'welcome', status: 'paused' })
    )
    expect(remapWelcomeCampaign).not.toHaveBeenCalled()
  })

  it('still auto-maps when PATCH flips type → welcome AND sets status=active', async () => {
    vi.mocked(getCampaignById).mockResolvedValueOnce(
      buildCampaign({ type: 'promo', status: 'draft' })
    )
    vi.mocked(updateCampaign).mockResolvedValueOnce(
      buildCampaign({ type: 'welcome', status: 'active' })
    )
    vi.mocked(getOnboardingSettings).mockResolvedValueOnce({
      welcomeCampaignId: 'prev-welcome-9',
      returningMemberTemplate: null,
      returningMemberTemplateEn: null,
      returningMemberTemplateZhHk: null,
      defaultLanguage: 'zh_hk',
    })

    const r = await PATCH(
      patchRequest({ type: 'welcome', status: 'active' }),
      { params: Promise.resolve({ id: CAMPAIGN_ID }) }
    )

    expect(r.status).toBe(200)
    expect(remapWelcomeCampaign).toHaveBeenCalledWith(
      RESTAURANT_ID,
      'prev-welcome-9',
      CAMPAIGN_ID
    )
  })

  it('skips auto-map when PATCH flips type → welcome on an existing paused campaign (no status change)', async () => {
    vi.mocked(getCampaignById).mockResolvedValueOnce(
      buildCampaign({ type: 'promo', status: 'paused' })
    )
    vi.mocked(updateCampaign).mockResolvedValueOnce(
      buildCampaign({ type: 'welcome', status: 'paused' })
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
    expect(remapWelcomeCampaign).not.toHaveBeenCalled()
  })

  it('auto-maps when PATCH flips type → welcome on an existing active campaign (no status change)', async () => {
    vi.mocked(getCampaignById).mockResolvedValueOnce(
      buildCampaign({ type: 'promo', status: 'active' })
    )
    vi.mocked(updateCampaign).mockResolvedValueOnce(
      buildCampaign({ type: 'welcome', status: 'active' })
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
    expect(remapWelcomeCampaign).toHaveBeenCalledWith(
      RESTAURANT_ID,
      'prev-welcome-9',
      CAMPAIGN_ID
    )
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
      buildCampaign({ type: 'promo', status: 'active' })
    )
    vi.mocked(updateCampaign).mockResolvedValueOnce(
      buildCampaign({ type: 'welcome', status: 'active' })
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

  // FIX 2: welcome-only scope guard. When the effective (next) type is
  // not 'welcome', the PATCH must clear any image URLs so a direct API
  // caller can't leave stale welcome images attached to a winback/promo.
  it('clears image URLs when PATCH flips type welcome → promo', async () => {
    vi.mocked(getCampaignById).mockResolvedValueOnce(
      buildCampaign({
        type: 'welcome',
        imageUrlEn: 'https://host/storage/v1/object/public/campaign-images/rest-1/c/en.png',
        imageUrlZhHk: 'https://host/storage/v1/object/public/campaign-images/rest-1/c/zh.png',
      })
    )

    await PATCH(patchRequest({ type: 'promo' }), {
      params: Promise.resolve({ id: CAMPAIGN_ID }),
    })

    expect(updateCampaign).toHaveBeenCalledWith(
      CAMPAIGN_ID,
      expect.objectContaining({
        type: 'promo',
        imageUrlEn: null,
        imageUrlZhHk: null,
      })
    )
  })

  // FIX 1: hardened URL validation via WHATWG URL parser. The PATCH path
  // must reject attacker-host/userinfo/non-URL inputs before the image
  // URLs hit the DB.
  it('rejects imageUrlEn with http:// scheme on a welcome PATCH', async () => {
    vi.mocked(getCampaignById).mockResolvedValueOnce(
      buildCampaign({ type: 'welcome' })
    )
    const r = await PATCH(
      patchRequest({
        imageUrlEn: `http://host/storage/v1/object/public/campaign-images/${RESTAURANT_ID}/x.png`,
      }),
      { params: Promise.resolve({ id: CAMPAIGN_ID }) }
    )
    expect(r.status).toBe(400)
  })

  it('rejects imageUrlEn containing userinfo on a welcome PATCH', async () => {
    vi.mocked(getCampaignById).mockResolvedValueOnce(
      buildCampaign({ type: 'welcome' })
    )
    const r = await PATCH(
      patchRequest({
        imageUrlEn: `https://u:p@host/storage/v1/object/public/campaign-images/${RESTAURANT_ID}/x.png`,
      }),
      { params: Promise.resolve({ id: CAMPAIGN_ID }) }
    )
    expect(r.status).toBe(400)
  })

  it('rejects a non-URL imageUrlEn on a welcome PATCH', async () => {
    vi.mocked(getCampaignById).mockResolvedValueOnce(
      buildCampaign({ type: 'welcome' })
    )
    const r = await PATCH(
      patchRequest({ imageUrlEn: 'definitely not a url' }),
      { params: Promise.resolve({ id: CAMPAIGN_ID }) }
    )
    expect(r.status).toBe(400)
  })

  it('rejects imageUrlEn targeting a different tenant on a welcome PATCH', async () => {
    vi.mocked(getCampaignById).mockResolvedValueOnce(
      buildCampaign({ type: 'welcome' })
    )
    const r = await PATCH(
      patchRequest({
        imageUrlEn:
          'https://host/storage/v1/object/public/campaign-images/other-tenant/x.png',
      }),
      { params: Promise.resolve({ id: CAMPAIGN_ID }) }
    )
    expect(r.status).toBe(400)
  })

  // P0 fix (review finding 2): a tenant-manager could resume an auto-paused
  // reconfirmation campaign with PATCH { status: 'active' }, bypassing the
  // platform-admin-only resume gate (Q-H2). The PATCH path now rejects any
  // status change on a reconfirmation-mode campaign EXCEPT 'archived'.
  it('returns 403 RECONFIRMATION_RESUME_REQUIRES_PLATFORM_ADMIN when tenant-manager PATCHes reconfirmation campaign with status=active', async () => {
    vi.mocked(getCampaignById).mockResolvedValueOnce(
      buildCampaign({ mode: 'reconfirmation', status: 'paused' })
    )
    const r = await PATCH(patchRequest({ status: 'active' }), {
      params: Promise.resolve({ id: CAMPAIGN_ID }),
    })
    expect(r.status).toBe(403)
    const body = await r.json()
    expect(body.reason).toBe('RECONFIRMATION_RESUME_REQUIRES_PLATFORM_ADMIN')
    expect(updateCampaign).not.toHaveBeenCalled()
  })

  it('also blocks PATCH { status: paused } on a reconfirmation campaign (only archive is allowed)', async () => {
    vi.mocked(getCampaignById).mockResolvedValueOnce(
      buildCampaign({ mode: 'reconfirmation', status: 'active' })
    )
    const r = await PATCH(patchRequest({ status: 'paused' }), {
      params: Promise.resolve({ id: CAMPAIGN_ID }),
    })
    expect(r.status).toBe(403)
  })

  // Forward-compat: when an 'archived' status is later added to the Campaign
  // union, tenants must still be able to end-of-life their own reconfirmation
  // campaigns without bouncing off a platform-admin gate. The PATCH layer
  // accepts the literal `'archived'` even today so this stays green when the
  // domain type is widened.
  it('allows tenant-manager to ARCHIVE a reconfirmation campaign via PATCH (forward-compat)', async () => {
    vi.mocked(getCampaignById).mockResolvedValueOnce(
      buildCampaign({ mode: 'reconfirmation', status: 'paused' })
    )
    vi.mocked(updateCampaign).mockResolvedValueOnce(buildCampaign())
    const r = await PATCH(patchRequest({ status: 'archived' }), {
      params: Promise.resolve({ id: CAMPAIGN_ID }),
    })
    expect(r.status).toBe(200)
    expect(updateCampaign).toHaveBeenCalledWith(
      CAMPAIGN_ID,
      expect.objectContaining({ status: 'archived' })
    )
  })

  it('still allows status changes on non-reconfirmation campaigns', async () => {
    vi.mocked(getCampaignById).mockResolvedValueOnce(
      buildCampaign({ mode: 'marketing', status: 'paused' })
    )
    const r = await PATCH(patchRequest({ status: 'active' }), {
      params: Promise.resolve({ id: CAMPAIGN_ID }),
    })
    expect(r.status).toBe(200)
    expect(updateCampaign).toHaveBeenCalledWith(
      CAMPAIGN_ID,
      expect.objectContaining({ status: 'active' })
    )
  })

  it('clears image URLs when PATCHing a non-welcome row (existing promo)', async () => {
    vi.mocked(getCampaignById).mockResolvedValueOnce(
      buildCampaign({ type: 'promo' })
    )

    await PATCH(
      patchRequest({
        imageUrlEn:
          `https://host/storage/v1/object/public/campaign-images/${RESTAURANT_ID}/c/en.png`,
        imageUrlZhHk:
          `https://host/storage/v1/object/public/campaign-images/${RESTAURANT_ID}/c/zh.png`,
      }),
      { params: Promise.resolve({ id: CAMPAIGN_ID }) }
    )

    expect(updateCampaign).toHaveBeenCalledWith(
      CAMPAIGN_ID,
      expect.objectContaining({
        imageUrlEn: null,
        imageUrlZhHk: null,
      })
    )
  })
})

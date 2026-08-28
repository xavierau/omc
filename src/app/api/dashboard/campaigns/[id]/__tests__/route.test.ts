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
    getCampaignByIdForRestaurant: vi.fn(),
    updateCampaign: vi.fn(),
    setCampaignMembers: vi.fn(),
    getCampaignMemberIds: vi.fn(),
    remapWelcomeCampaign: vi.fn(),
  }
})
vi.mock('@/infrastructure/supabase/repositories/restaurant-onboarding-repository')
vi.mock('@/infrastructure/supabase/repositories/campaign-tags-repository', async () => {
  const actual = await vi.importActual<
    typeof import('@/infrastructure/supabase/repositories/campaign-tags-repository')
  >('@/infrastructure/supabase/repositories/campaign-tags-repository')
  return { ...actual, getCampaignTagIds: vi.fn() }
})
vi.mock('@/application/set-campaign-tags', async () => {
  // Keep the real CrossTenantTagError so `instanceof` checks in route.ts match.
  const actual = await vi.importActual<
    typeof import('@/application/set-campaign-tags')
  >('@/application/set-campaign-tags')
  return { ...actual, setCampaignTags: vi.fn() }
})
vi.mock('@/application/build-campaign-template-review-states', () => ({
  buildCampaignTemplateReviewStates: vi.fn().mockResolvedValue(new Map()),
}))

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import {
  getCampaignById,
  getCampaignByIdForRestaurant,
  updateCampaign,
  setCampaignMembers,
  getCampaignMemberIds,
  remapWelcomeCampaign,
  CampaignUniqueViolationError,
} from '@/infrastructure/supabase/repositories/campaign-repository'
import {
  getRestaurantDefaultLanguage,
  getOnboardingSettings,
} from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import { getCampaignTagIds } from '@/infrastructure/supabase/repositories/campaign-tags-repository'
import { setCampaignTags, CrossTenantTagError } from '@/application/set-campaign-tags'
import { buildCampaignTemplateReviewStates } from '@/application/build-campaign-template-review-states'
import { GET, PATCH } from '../route'
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
    failureReason: null,
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

  // Review round 2, item 4: failure_reason is non-null ONLY when
  // status='failed'. Reviving a failed campaign back to 'active' must
  // clear the stale reason, or the UI would keep showing an old failure
  // after a successful retry. A revived campaign with a stale (past)
  // scheduledAt is deliberately left as-is: it becomes immediately due on
  // the next cron tick, same as reactivating any other paused campaign —
  // that is the intended "retry now" behavior, not a bug.
  it("clears failureReason when PATCH revives a failed campaign to 'active'", async () => {
    vi.mocked(getCampaignById).mockResolvedValueOnce(
      buildCampaign({
        status: 'failed',
        failureReason: 'Template requires platform approval',
        scheduledAt: '2026-01-01T00:00:00Z', // stale — intentionally untouched
      })
    )

    const r = await PATCH(patchRequest({ status: 'active' }), {
      params: Promise.resolve({ id: CAMPAIGN_ID }),
    })

    expect(r.status).toBe(200)
    expect(updateCampaign).toHaveBeenCalledWith(
      CAMPAIGN_ID,
      expect.objectContaining({ status: 'active', failureReason: null })
    )
    // scheduledAt was never part of this PATCH body, so it must not be
    // touched by the revival guard — it stays whatever it was, and a
    // stale past value makes the campaign immediately due again.
    expect(updateCampaign).toHaveBeenCalledWith(
      CAMPAIGN_ID,
      expect.not.objectContaining({ scheduledAt: expect.anything() })
    )
  })

  it('does not set failureReason when PATCH does not touch status', async () => {
    vi.mocked(getCampaignById).mockResolvedValueOnce(
      buildCampaign({ status: 'active', failureReason: null })
    )

    await PATCH(patchRequest({ templateEn: 'Hi' }), {
      params: Promise.resolve({ id: CAMPAIGN_ID }),
    })

    const [, changes] = vi.mocked(updateCampaign).mock.calls[0]
    expect('failureReason' in changes).toBe(false)
  })

  // Review round 3, item 3: 'failed' is a system-managed terminal status —
  // only the queue worker (markCampaignFailed, on retry exhaustion) may
  // set it, always paired with a failureReason. A direct PATCH bypasses
  // that and would leave failureReason unset.
  it("rejects a PATCH setting status to 'failed' directly", async () => {
    const r = await PATCH(patchRequest({ status: 'failed' }), {
      params: Promise.resolve({ id: CAMPAIGN_ID }),
    })
    expect(r.status).toBe(400)
    const body = await r.json()
    expect(body.error).toMatch(/failed/i)
    expect(updateCampaign).not.toHaveBeenCalled()
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

// Issue #102 fix 4: single-campaign GET also gains the optional
// failureReason/templateReview fields, so the campaign-detail view can
// explain a blocked/failed send the same way the list view does.
//
// Review round 2, item 1: GET is now tenant-scoped via
// getCampaignByIdForRestaurant (SEC-001 pattern) instead of
// getCampaignById + fetch-then-compare — a foreign id answers 404
// identically to a missing one.
describe('GET /api/dashboard/campaigns/[id]', () => {
  beforeEach(() => {
    vi.mocked(getCampaignById).mockReset()
    vi.mocked(getCampaignByIdForRestaurant).mockReset()
    vi.mocked(getCampaignMemberIds).mockReset()
    vi.mocked(getTenantContext).mockReset()
    vi.mocked(buildCampaignTemplateReviewStates).mockReset()
    vi.mocked(getTenantContext).mockResolvedValue({
      userId: 'u-1',
      restaurantId: RESTAURANT_ID,
      role: 'admin',
      tenantStatus: 'active',
    })
    vi.mocked(getCampaignByIdForRestaurant).mockResolvedValue(buildCampaign())
    vi.mocked(buildCampaignTemplateReviewStates).mockResolvedValue(new Map())
  })

  function getRequest(): NextRequest {
    return new NextRequest(
      `http://localhost/api/dashboard/campaigns/${CAMPAIGN_ID}`
    )
  }

  it('returns 404 when the campaign does not exist', async () => {
    vi.mocked(getCampaignByIdForRestaurant).mockResolvedValue(null)

    const r = await GET(getRequest(), { params: Promise.resolve({ id: CAMPAIGN_ID }) })

    expect(r.status).toBe(404)
  })

  it('scopes the lookup by the caller restaurantId (never fetch-then-compare)', async () => {
    await GET(getRequest(), { params: Promise.resolve({ id: CAMPAIGN_ID }) })

    expect(getCampaignByIdForRestaurant).toHaveBeenCalledWith(CAMPAIGN_ID, RESTAURANT_ID)
    expect(getCampaignById).not.toHaveBeenCalled()
  })

  it('returns 404 for a cross-tenant id (scoped query answers null, not a leak)', async () => {
    // A caller from rest-2 requesting a campaign owned by rest-1: the
    // scoped query can never return it, so this reads identically to a
    // truly-missing id — no existence leak via a different status code.
    vi.mocked(getTenantContext).mockResolvedValue({
      userId: 'u-2',
      restaurantId: 'rest-2',
      role: 'admin',
      tenantStatus: 'active',
    })
    vi.mocked(getCampaignByIdForRestaurant).mockResolvedValue(null)

    const r = await GET(getRequest(), { params: Promise.resolve({ id: CAMPAIGN_ID }) })

    expect(r.status).toBe(404)
    expect(getCampaignByIdForRestaurant).toHaveBeenCalledWith(CAMPAIGN_ID, 'rest-2')
  })

  it('returns the campaign normally for a same-tenant request', async () => {
    vi.mocked(getCampaignByIdForRestaurant).mockResolvedValue(
      buildCampaign({ id: CAMPAIGN_ID, restaurantId: RESTAURANT_ID })
    )

    const r = await GET(getRequest(), { params: Promise.resolve({ id: CAMPAIGN_ID }) })
    const body = await r.json()

    expect(r.status).toBe(200)
    expect(body.id).toBe(CAMPAIGN_ID)
  })

  it('includes failureReason from the campaign entity', async () => {
    vi.mocked(getCampaignByIdForRestaurant).mockResolvedValue(
      buildCampaign({ status: 'failed', failureReason: 'boom' })
    )

    const r = await GET(getRequest(), { params: Promise.resolve({ id: CAMPAIGN_ID }) })
    const body = await r.json()

    expect(body.failureReason).toBe('boom')
  })

  // Review round 3, item 2: the list route already degrades OFF (REPLY-001
  // precedent) when the enrichment throws — the detail view must behave
  // the same way instead of 500ing the whole campaign.
  it('degrades OFF (still returns the campaign, minus templateReview) when the enrichment throws', async () => {
    vi.mocked(getCampaignByIdForRestaurant).mockResolvedValue(
      buildCampaign({ id: CAMPAIGN_ID, status: 'failed', failureReason: 'boom' })
    )
    vi.mocked(buildCampaignTemplateReviewStates).mockRejectedValue(
      new Error('template_review_queue unreachable')
    )
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const r = await GET(getRequest(), { params: Promise.resolve({ id: CAMPAIGN_ID }) })
    const body = await r.json()

    expect(r.status).toBe(200)
    // failureReason still comes straight from the campaign entity — no
    // extra query, so it survives the enrichment failure untouched.
    expect(body.failureReason).toBe('boom')
    expect('templateReview' in body).toBe(false)

    errSpy.mockRestore()
  })

  it('attaches templateReview when the state map has an entry for this campaign', async () => {
    vi.mocked(buildCampaignTemplateReviewStates).mockResolvedValue(
      new Map([[CAMPAIGN_ID, { required: true, status: 'pending' }]])
    )

    const r = await GET(getRequest(), { params: Promise.resolve({ id: CAMPAIGN_ID }) })
    const body = await r.json()

    expect(body.templateReview).toEqual({ required: true, status: 'pending' })
  })

  it('omits templateReview when no state applies (no MARKETING template)', async () => {
    const r = await GET(getRequest(), { params: Promise.resolve({ id: CAMPAIGN_ID }) })
    const body = await r.json()

    expect('templateReview' in body).toBe(false)
  })

  it('computes review state scoped to the campaign owner restaurantId', async () => {
    const campaign = buildCampaign()
    vi.mocked(getCampaignByIdForRestaurant).mockResolvedValue(campaign)

    await GET(getRequest(), { params: Promise.resolve({ id: CAMPAIGN_ID }) })

    expect(buildCampaignTemplateReviewStates).toHaveBeenCalledWith(
      RESTAURANT_ID,
      [campaign]
    )
  })
})

// TAG-001 regression: the tag vertical slice must load and persist on EDIT,
// mirroring how 'selected'/memberIds already works.
describe('GET /api/dashboard/campaigns/[id] — tag audience', () => {
  beforeEach(() => {
    vi.mocked(getTenantContext).mockReset()
    vi.mocked(getTenantContext).mockResolvedValue({
      userId: 'u-1',
      restaurantId: RESTAURANT_ID,
      role: 'admin',
      tenantStatus: 'active',
    })
    vi.mocked(getCampaignByIdForRestaurant).mockReset()
    vi.mocked(getCampaignTagIds).mockReset()
    vi.mocked(buildCampaignTemplateReviewStates).mockReset()
    vi.mocked(buildCampaignTemplateReviewStates).mockResolvedValue(new Map())
  })

  it('returns tagIds for a tag-targeted campaign', async () => {
    vi.mocked(getCampaignByIdForRestaurant).mockResolvedValue(
      buildCampaign({ targetAudience: 'tag' })
    )
    vi.mocked(getCampaignTagIds).mockResolvedValue(['tag-1', 'tag-2'])

    const r = await GET(new NextRequest('http://localhost'), {
      params: Promise.resolve({ id: CAMPAIGN_ID }),
    })

    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.tagIds).toEqual(['tag-1', 'tag-2'])
    expect(getCampaignTagIds).toHaveBeenCalledWith(CAMPAIGN_ID)
  })
})

describe('PATCH /api/dashboard/campaigns/[id] — tag persistence', () => {
  beforeEach(() => {
    vi.mocked(getTenantContext).mockReset()
    vi.mocked(getTenantContext).mockResolvedValue({
      userId: 'u-1',
      restaurantId: RESTAURANT_ID,
      role: 'admin',
      tenantStatus: 'active',
    })
    vi.mocked(getCampaignById).mockReset()
    vi.mocked(updateCampaign).mockReset()
    vi.mocked(setCampaignTags).mockReset()
    vi.mocked(getCampaignById).mockResolvedValue(
      buildCampaign({ targetAudience: 'tag' })
    )
    vi.mocked(updateCampaign).mockResolvedValue(
      buildCampaign({ targetAudience: 'tag' })
    )
    vi.mocked(setCampaignTags).mockResolvedValue(undefined)
  })

  it('persists tagIds via setCampaignTags(id, tagIds, restaurantId)', async () => {
    const r = await PATCH(
      patchRequest({ targetAudience: 'tag', tagIds: ['tag-1'] }),
      { params: Promise.resolve({ id: CAMPAIGN_ID }) }
    )

    expect(r.status).toBe(200)
    expect(setCampaignTags).toHaveBeenCalledWith(
      CAMPAIGN_ID,
      ['tag-1'],
      RESTAURANT_ID
    )
  })

  it('returns 400 when a cross-tenant tag is rejected', async () => {
    vi.mocked(setCampaignTags).mockRejectedValueOnce(
      new CrossTenantTagError('Invalid tag IDs')
    )

    const r = await PATCH(
      patchRequest({ targetAudience: 'tag', tagIds: ['other-tenant-tag'] }),
      { params: Promise.resolve({ id: CAMPAIGN_ID }) }
    )

    expect(r.status).toBe(400)
  })
})

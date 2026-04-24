import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/infrastructure/supabase/repositories/campaign-repository', async () => {
  // Keep the real error class so `instanceof` checks in route.ts match
  // when tests simulate repository failures.
  const actual = await vi.importActual<
    typeof import('@/infrastructure/supabase/repositories/campaign-repository')
  >('@/infrastructure/supabase/repositories/campaign-repository')
  return {
    ...actual,
    createCampaign: vi.fn(),
    listCampaigns: vi.fn(),
    setCampaignMembers: vi.fn(),
    remapWelcomeCampaign: vi.fn(),
  }
})
vi.mock('@/infrastructure/supabase/repositories/restaurant-onboarding-repository')

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import {
  createCampaign,
  listCampaigns,
  setCampaignMembers,
  remapWelcomeCampaign,
  CampaignUniqueViolationError,
} from '@/infrastructure/supabase/repositories/campaign-repository'
import {
  getRestaurantDefaultLanguage,
  getOnboardingSettings,
} from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import { POST, GET } from '../route'
import type { Campaign } from '@/domain/entities/campaign'

const RESTAURANT_ID = 'rest-1'

function postRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/dashboard/campaigns', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

function buildCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 'c-1',
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

describe('POST /api/dashboard/campaigns', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getTenantContext).mockResolvedValue({
      userId: 'u-1',
      restaurantId: RESTAURANT_ID,
      role: 'admin',
      tenantStatus: 'active',
    })
    vi.mocked(createCampaign).mockResolvedValue(buildCampaign())
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

  it('rejects when name is missing', async () => {
    const r = await POST(postRequest({ type: 'promo', templateEn: 'hi' }))
    expect(r.status).toBe(400)
  })

  it('rejects when type is invalid', async () => {
    const r = await POST(postRequest({ name: 'n', type: 'xxx', templateEn: 'hi' }))
    expect(r.status).toBe(400)
  })

  it('rejects inline send with no template in any language and no wa template', async () => {
    const r = await POST(postRequest({ name: 'n', type: 'promo' }))
    expect(r.status).toBe(400)
    const body = await r.json()
    expect(body.error).toContain('templateEn')
  })

  it('accepts bilingual templateEn', async () => {
    const r = await POST(
      postRequest({ name: 'n', type: 'promo', templateEn: 'Hi {{name}}' })
    )
    expect(r.status).toBe(201)
    expect(createCampaign).toHaveBeenCalledWith(
      expect.objectContaining({
        templateEn: 'Hi {{name}}',
        templateZhHk: null,
      })
    )
  })

  it('accepts bilingual templateZhHk', async () => {
    const r = await POST(
      postRequest({ name: 'n', type: 'promo', templateZhHk: '你好' })
    )
    expect(r.status).toBe(201)
    expect(createCampaign).toHaveBeenCalledWith(
      expect.objectContaining({
        templateEn: null,
        templateZhHk: '你好',
      })
    )
  })

  it('accepts whatsappTemplateId alone without inline text', async () => {
    const r = await POST(
      postRequest({ name: 'n', type: 'promo', whatsappTemplateId: 'tpl-1' })
    )
    expect(r.status).toBe(201)
  })

  it('back-compat: legacy template-only copies value to templateZhHk', async () => {
    const r = await POST(
      postRequest({ name: 'n', type: 'promo', template: 'LegacyOnly' })
    )
    expect(r.status).toBe(201)
    expect(createCampaign).toHaveBeenCalledWith(
      expect.objectContaining({
        legacyTemplate: 'LegacyOnly',
        templateEn: null,
        templateZhHk: 'LegacyOnly',
      })
    )
  })

  it('does not override explicit templateZhHk with legacy template', async () => {
    const r = await POST(
      postRequest({
        name: 'n',
        type: 'promo',
        template: 'LegacyOnly',
        templateZhHk: '你好',
      })
    )
    expect(r.status).toBe(201)
    expect(createCampaign).toHaveBeenCalledWith(
      expect.objectContaining({
        templateZhHk: '你好',
      })
    )
  })

  it('rejects oversize bilingual template', async () => {
    const big = 'a'.repeat(1025)
    const r = await POST(
      postRequest({ name: 'n', type: 'promo', templateEn: big })
    )
    expect(r.status).toBe(400)
  })

  it('derives legacy template from EN when default_language=en and only EN is sent', async () => {
    vi.mocked(getRestaurantDefaultLanguage).mockResolvedValueOnce('en')
    const r = await POST(
      postRequest({ name: 'n', type: 'promo', templateEn: 'Hi' })
    )
    expect(r.status).toBe(201)
    expect(createCampaign).toHaveBeenCalledWith(
      expect.objectContaining({
        legacyTemplate: 'Hi',
        templateEn: 'Hi',
        templateZhHk: null,
      })
    )
  })

  it('cross-language fallback: default_language=zh_hk but only EN sent uses EN for legacy', async () => {
    vi.mocked(getRestaurantDefaultLanguage).mockResolvedValueOnce('zh_hk')
    const r = await POST(
      postRequest({ name: 'n', type: 'promo', templateEn: 'Hi' })
    )
    expect(r.status).toBe(201)
    expect(createCampaign).toHaveBeenCalledWith(
      expect.objectContaining({
        legacyTemplate: 'Hi',
      })
    )
  })

  it('picks default_language value for legacy when both languages are sent', async () => {
    vi.mocked(getRestaurantDefaultLanguage).mockResolvedValueOnce('en')
    const r = await POST(
      postRequest({
        name: 'n',
        type: 'promo',
        templateEn: 'Hi',
        templateZhHk: '你好',
      })
    )
    expect(r.status).toBe(201)
    expect(createCampaign).toHaveBeenCalledWith(
      expect.objectContaining({
        legacyTemplate: 'Hi',
      })
    )
  })

  it('leaves legacy as empty string when only whatsappTemplateId is used', async () => {
    const r = await POST(
      postRequest({ name: 'n', type: 'promo', whatsappTemplateId: 'tpl-1' })
    )
    expect(r.status).toBe(201)
    expect(createCampaign).toHaveBeenCalledWith(
      expect.objectContaining({
        legacyTemplate: '',
      })
    )
  })

  it('passes restaurantId to setCampaignMembers for cross-tenant validation', async () => {
    const r = await POST(
      postRequest({
        name: 'n',
        type: 'promo',
        templateEn: 'Hi',
        targetAudience: 'selected',
        memberIds: ['m-1', 'm-2'],
      })
    )
    expect(r.status).toBe(201)
    expect(setCampaignMembers).toHaveBeenCalledWith('c-1', ['m-1', 'm-2'], RESTAURANT_ID)
  })

  // FIX 2: partial unique index forbids two active welcome campaigns per
  // restaurant. When the DB rejects the insert with 23505, surface a 409
  // with a friendly message instead of a generic 500.
  it('returns 409 when a second active welcome campaign violates the unique index', async () => {
    vi.mocked(createCampaign).mockRejectedValueOnce(
      new CampaignUniqueViolationError(
        'idx_campaigns_one_active_welcome_per_restaurant',
        'duplicate key value violates unique constraint'
      )
    )
    const r = await POST(
      postRequest({
        name: 'n',
        type: 'welcome',
        templateEn: 'Hi',
        status: 'active',
      })
    )
    expect(r.status).toBe(409)
    const body = await r.json()
    expect(body.error).toContain('welcome campaign already exists')
  })

  // FIX 3: creating a welcome campaign via the form should auto-map it
  // as THE welcome campaign so the RPC flips is_chargeable=false (intent:
  // admins who create type='welcome' mean it to be the one).
  it('auto-maps newly created welcome campaigns via remapWelcomeCampaign', async () => {
    vi.mocked(createCampaign).mockResolvedValueOnce(
      buildCampaign({ id: 'new-welcome-1', type: 'welcome' })
    )
    const r = await POST(
      postRequest({ name: 'n', type: 'welcome', templateEn: 'Hi' })
    )
    expect(r.status).toBe(201)
    expect(remapWelcomeCampaign).toHaveBeenCalledWith(
      RESTAURANT_ID,
      null,
      'new-welcome-1'
    )
  })

  it('auto-map passes previous welcome campaign id when one already mapped', async () => {
    vi.mocked(getOnboardingSettings).mockResolvedValueOnce({
      welcomeCampaignId: 'old-welcome-7',
      returningMemberTemplate: null,
      returningMemberTemplateEn: null,
      returningMemberTemplateZhHk: null,
      defaultLanguage: 'zh_hk',
    })
    vi.mocked(createCampaign).mockResolvedValueOnce(
      buildCampaign({ id: 'new-welcome-2', type: 'welcome' })
    )
    const r = await POST(
      postRequest({ name: 'n', type: 'welcome', templateEn: 'Hi' })
    )
    expect(r.status).toBe(201)
    expect(remapWelcomeCampaign).toHaveBeenCalledWith(
      RESTAURANT_ID,
      'old-welcome-7',
      'new-welcome-2'
    )
  })

  it('does not call remapWelcomeCampaign for non-welcome campaign types', async () => {
    const r = await POST(
      postRequest({ name: 'n', type: 'promo', templateEn: 'Hi' })
    )
    expect(r.status).toBe(201)
    expect(remapWelcomeCampaign).not.toHaveBeenCalled()
  })

  it('does not block the response when remapWelcomeCampaign fails (best-effort)', async () => {
    vi.mocked(createCampaign).mockResolvedValueOnce(
      buildCampaign({ id: 'new-welcome-3', type: 'welcome' })
    )
    vi.mocked(remapWelcomeCampaign).mockRejectedValueOnce(new Error('rpc down'))
    const r = await POST(
      postRequest({ name: 'n', type: 'welcome', templateEn: 'Hi' })
    )
    expect(r.status).toBe(201)
  })

  // FIX 3: image URL validation — reject non-https, non-bucket, or cross-tenant URLs.
  it('rejects imageUrlEn with javascript: scheme', async () => {
    const r = await POST(
      postRequest({
        name: 'n',
        type: 'welcome',
        templateEn: 'Hi',
        imageUrlEn: 'javascript:alert(1)',
      })
    )
    expect(r.status).toBe(400)
  })

  it('rejects imageUrlEn served over http:// (non-https)', async () => {
    const r = await POST(
      postRequest({
        name: 'n',
        type: 'welcome',
        templateEn: 'Hi',
        imageUrlEn: 'http://evil.com/x.png',
      })
    )
    expect(r.status).toBe(400)
  })

  it('rejects imageUrlEn pointing at another tenant prefix', async () => {
    const r = await POST(
      postRequest({
        name: 'n',
        type: 'welcome',
        templateEn: 'Hi',
        imageUrlEn:
          'https://host/storage/v1/object/public/campaign-images/other-tenant-9/c/en.png',
      })
    )
    expect(r.status).toBe(400)
  })

  it('accepts imageUrlEn with the correct https + bucket + tenant prefix', async () => {
    const r = await POST(
      postRequest({
        name: 'n',
        type: 'welcome',
        templateEn: 'Hi',
        imageUrlEn:
          `https://host/storage/v1/object/public/campaign-images/${RESTAURANT_ID}/draft-xyz/en.png`,
      })
    )
    expect(r.status).toBe(201)
  })

  // FIX 1: hardened URL host validation via WHATWG URL parser. Attackers
  // who embed the campaign-images path after an attacker-controlled host,
  // userinfo (credential smuggling), or an unparseable URL must be rejected
  // even before the tenant-prefix check.
  it('rejects imageUrlEn with an unparseable URL (not a valid URL at all)', async () => {
    const r = await POST(
      postRequest({
        name: 'n',
        type: 'welcome',
        templateEn: 'Hi',
        imageUrlEn: 'not a url at all',
      })
    )
    expect(r.status).toBe(400)
  })

  it('rejects imageUrlEn containing userinfo (credential smuggling)', async () => {
    const r = await POST(
      postRequest({
        name: 'n',
        type: 'welcome',
        templateEn: 'Hi',
        imageUrlEn:
          `https://user:pass@host/storage/v1/object/public/campaign-images/${RESTAURANT_ID}/c/en.png`,
      })
    )
    expect(r.status).toBe(400)
  })


  // FIX 2: image URLs are welcome-only. A non-welcome type must have both
  // image URLs coerced to null server-side even if the caller includes them.
  it('forces image URLs to null when type !== welcome (POST scope guard)', async () => {
    const validUrl =
      `https://host/storage/v1/object/public/campaign-images/${RESTAURANT_ID}/draft-abc/en.png`
    const r = await POST(
      postRequest({
        name: 'n',
        type: 'winback',
        templateEn: 'Hi',
        imageUrlEn: validUrl,
        imageUrlZhHk: validUrl,
      })
    )
    expect(r.status).toBe(201)
    expect(createCampaign).toHaveBeenCalledWith(
      expect.objectContaining({
        imageUrlEn: null,
        imageUrlZhHk: null,
      })
    )
  })
})

describe('GET /api/dashboard/campaigns', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getTenantContext).mockResolvedValue({
      userId: 'u-1',
      restaurantId: RESTAURANT_ID,
      role: 'admin',
      tenantStatus: 'active',
    })
    vi.mocked(listCampaigns).mockResolvedValue([])
  })

  it('returns campaigns list', async () => {
    const r = await GET()
    expect(r.status).toBe(200)
  })
})

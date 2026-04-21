import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/infrastructure/supabase/repositories/campaign-repository')
vi.mock('@/infrastructure/supabase/repositories/restaurant-onboarding-repository')

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import {
  getCampaignById,
  updateCampaign,
  setCampaignMembers,
} from '@/infrastructure/supabase/repositories/campaign-repository'
import { getRestaurantDefaultLanguage } from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
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
})

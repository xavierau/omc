import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/infrastructure/supabase/repositories/campaign-repository')

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import {
  createCampaign,
  listCampaigns,
  setCampaignMembers,
} from '@/infrastructure/supabase/repositories/campaign-repository'
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
        template: 'LegacyOnly',
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

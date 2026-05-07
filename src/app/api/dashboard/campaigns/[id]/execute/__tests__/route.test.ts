import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/infrastructure/supabase/repositories/campaign-repository', () => ({
  getCampaignById: vi.fn(),
}))
vi.mock('@/infrastructure/queue/campaign-queue', () => ({
  addCampaignJob: vi.fn(),
}))

import { POST } from '../route'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { getCampaignById } from '@/infrastructure/supabase/repositories/campaign-repository'
import { addCampaignJob } from '@/infrastructure/queue/campaign-queue'
import type { Campaign } from '@/domain/entities/campaign'

const TENANT_A = 'rest-aaa'
const TENANT_B = 'rest-bbb'
const CAMPAIGN_ID = 'camp-1'

function req(): NextRequest {
  return new NextRequest(
    `http://localhost/api/dashboard/campaigns/${CAMPAIGN_ID}/execute`,
    { method: 'POST' }
  )
}

function ctx() {
  return { params: Promise.resolve({ id: CAMPAIGN_ID }) }
}

function buildCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: CAMPAIGN_ID,
    restaurantId: TENANT_A,
    name: 'X',
    type: 'promo',
    template: 'T',
    templateEn: null,
    templateZhHk: null,
    imageUrlEn: null,
    imageUrlZhHk: null,
    couponConfig: null,
    schedule: null,
    scheduledAt: null,
    status: 'active',
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

describe('POST /api/dashboard/campaigns/[id]/execute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getTenantContext).mockResolvedValue({
      userId: 'u-1',
      restaurantId: TENANT_A,
      role: 'admin',
      tenantStatus: 'active',
    })
    vi.mocked(getCampaignById).mockResolvedValue(buildCampaign())
    vi.mocked(addCampaignJob).mockResolvedValue(undefined)
  })

  it('queues the job on the happy path (caller owns the campaign)', async () => {
    const r = await POST(req(), ctx())
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.status).toBe('queued')
    expect(addCampaignJob).toHaveBeenCalledWith({
      campaignId: CAMPAIGN_ID,
      restaurantId: TENANT_A,
    })
  })

  it('returns 404 when the campaign does not exist', async () => {
    vi.mocked(getCampaignById).mockResolvedValueOnce(null)
    const r = await POST(req(), ctx())
    expect(r.status).toBe(404)
    expect(addCampaignJob).not.toHaveBeenCalled()
  })

  // P0 fix (review finding 3): pre-existing IDOR — Tenant A could call
  // execute with Tenant B's campaign id and trigger Tenant B's send. The
  // route now compares campaign.restaurantId against the caller's
  // restaurantId and collapses both "not found" and "cross-tenant" to the
  // same 404 (so the API can't be used to enumerate campaign ids).
  it('returns 404 when caller is from a different tenant (IDOR fix)', async () => {
    vi.mocked(getCampaignById).mockResolvedValueOnce(
      buildCampaign({ restaurantId: TENANT_B })
    )
    const r = await POST(req(), ctx())
    expect(r.status).toBe(404)
    expect(addCampaignJob).not.toHaveBeenCalled()
  })

  it('returns 400 when the campaign is not active', async () => {
    vi.mocked(getCampaignById).mockResolvedValueOnce(
      buildCampaign({ status: 'paused' })
    )
    const r = await POST(req(), ctx())
    expect(r.status).toBe(400)
    expect(addCampaignJob).not.toHaveBeenCalled()
  })
})

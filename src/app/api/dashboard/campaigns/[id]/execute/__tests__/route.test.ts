import { describe, it, expect, vi, beforeEach } from 'vitest'

// Issue #102 Part A fix 2: `enforceTemplateReview` must run BEFORE
// enqueueing, synchronously in the request, so a blocked send returns 403
// with the violation in the response body instead of `200 {"status":
// "queued"}` while the real failure only ever surfaces in the worker log.

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/infrastructure/supabase/repositories/campaign-repository', () => ({
  getCampaignById: vi.fn(),
}))
vi.mock('@/infrastructure/queue/campaign-queue', () => ({
  addCampaignJob: vi.fn(),
}))
vi.mock('@/application/resolve-whatsapp-template', () => ({
  resolveWhatsAppTemplate: vi.fn(),
}))
vi.mock('@/application/enforce-template-review', () => ({
  enforceTemplateReview: vi.fn(),
}))

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { getCampaignById } from '@/infrastructure/supabase/repositories/campaign-repository'
import { addCampaignJob } from '@/infrastructure/queue/campaign-queue'
import { resolveWhatsAppTemplate } from '@/application/resolve-whatsapp-template'
import { enforceTemplateReview } from '@/application/enforce-template-review'
import { CampaignGuardrailError } from '@/application/campaign-guardrail-error'
import { POST } from '../route'
import { buildCampaign } from '@/test-utils/builders'

const RESTAURANT_ID = 'rest-1'
const CAMPAIGN_ID = 'camp-1'

function params() {
  return { params: Promise.resolve({ id: CAMPAIGN_ID }) }
}

describe('POST /api/dashboard/campaigns/[id]/execute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getTenantContext).mockResolvedValue({
      userId: 'u-1',
      restaurantId: RESTAURANT_ID,
      role: 'admin',
      tenantStatus: 'active',
    })
    vi.mocked(getCampaignById).mockResolvedValue(
      buildCampaign({ id: CAMPAIGN_ID, restaurantId: RESTAURANT_ID, status: 'active' })
    )
    vi.mocked(resolveWhatsAppTemplate).mockResolvedValue(null)
    vi.mocked(enforceTemplateReview).mockResolvedValue(undefined)
    vi.mocked(addCampaignJob).mockResolvedValue(undefined)
  })

  it('enqueues and returns 200 when the template-review gate allows the send', async () => {
    const r = await POST(new Request('http://x') as never, params())
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body).toEqual({ status: 'queued' })
    expect(addCampaignJob).toHaveBeenCalledWith({
      campaignId: CAMPAIGN_ID,
      restaurantId: RESTAURANT_ID,
    })
  })

  it('runs enforceTemplateReview with the resolved template BEFORE enqueueing', async () => {
    const campaign = buildCampaign({ id: CAMPAIGN_ID, restaurantId: RESTAURANT_ID, status: 'active' })
    vi.mocked(getCampaignById).mockResolvedValue(campaign)
    const order: string[] = []
    vi.mocked(enforceTemplateReview).mockImplementation(async () => {
      order.push('enforce')
    })
    vi.mocked(addCampaignJob).mockImplementation(async () => {
      order.push('enqueue')
    })

    await POST(new Request('http://x') as never, params())

    expect(order).toEqual(['enforce', 'enqueue'])
    expect(enforceTemplateReview).toHaveBeenCalledWith({
      campaign,
      restaurantId: RESTAURANT_ID,
      template: null,
    })
  })

  it('returns 403 with violations and does NOT enqueue when the gate blocks the send', async () => {
    vi.mocked(enforceTemplateReview).mockRejectedValue(
      new CampaignGuardrailError([
        "Template '5th_anniversary' requires platform approval before sending (campaign camp-1)",
      ])
    )

    const r = await POST(new Request('http://x') as never, params())

    expect(r.status).toBe(403)
    const body = await r.json()
    expect(body).toEqual({
      error: 'Campaign blocked by guardrails',
      violations: [
        "Template '5th_anniversary' requires platform approval before sending (campaign camp-1)",
      ],
    })
    expect(addCampaignJob).not.toHaveBeenCalled()
  })

  it('returns 404 when the campaign does not exist', async () => {
    vi.mocked(getCampaignById).mockResolvedValue(null)

    const r = await POST(new Request('http://x') as never, params())

    expect(r.status).toBe(404)
    expect(enforceTemplateReview).not.toHaveBeenCalled()
    expect(addCampaignJob).not.toHaveBeenCalled()
  })

  it('returns 400 when the campaign is not active, without running the gate', async () => {
    vi.mocked(getCampaignById).mockResolvedValue(
      buildCampaign({ id: CAMPAIGN_ID, restaurantId: RESTAURANT_ID, status: 'paused' })
    )

    const r = await POST(new Request('http://x') as never, params())

    expect(r.status).toBe(400)
    expect(enforceTemplateReview).not.toHaveBeenCalled()
    expect(addCampaignJob).not.toHaveBeenCalled()
  })
})

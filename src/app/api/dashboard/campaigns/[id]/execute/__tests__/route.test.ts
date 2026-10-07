import { describe, it, expect, vi, beforeEach } from 'vitest'

// Issue #102 Part A fix 2 + review round 2 (items 1, 2, 3): the execute
// route now runs every send-time gate synchronously, in the SAME order the
// worker does, BEFORE enqueueing — so a blocked send returns a typed
// 4xx with the real reason instead of `200 {"status":"queued"}` while the
// real failure only ever surfaced in the worker log or (worse) permanently
// failed the campaign after 3 blind retries.
//
// Order mirrors executeCampaign: guardrails (item 2, count=0 like the cron)
// -> resolve template (item 3, typed errors) -> WAQ-011 template review.
// The campaign lookup itself is tenant-scoped (item 1) so a cross-tenant id
// 404s instead of leaking another tenant's guardrail violations.

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/infrastructure/supabase/repositories/campaign-repository', () => ({
  getCampaignByIdForRestaurant: vi.fn(),
}))
vi.mock('@/infrastructure/queue/campaign-queue', () => ({
  addCampaignJob: vi.fn(),
}))
vi.mock('@/application/resolve-whatsapp-template', async () => {
  const actual = await vi.importActual<
    typeof import('@/application/resolve-whatsapp-template')
  >('@/application/resolve-whatsapp-template')
  return {
    ...actual,
    resolveWhatsAppTemplate: vi.fn(),
  }
})
vi.mock('@/application/enforce-template-review', () => ({
  enforceTemplateReview: vi.fn(),
}))
vi.mock('@/application/enforce-campaign-guardrails', () => ({
  enforceCampaignGuardrails: vi.fn(),
}))

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { getCampaignByIdForRestaurant } from '@/infrastructure/supabase/repositories/campaign-repository'
import { addCampaignJob } from '@/infrastructure/queue/campaign-queue'
import {
  resolveWhatsAppTemplate,
  WhatsAppTemplateNotFoundError,
  WhatsAppTemplateNotApprovedError,
} from '@/application/resolve-whatsapp-template'
import { enforceTemplateReview } from '@/application/enforce-template-review'
import { enforceCampaignGuardrails } from '@/application/enforce-campaign-guardrails'
import { CampaignGuardrailError } from '@/application/campaign-guardrail-error'
import { POST } from '../route'
import { buildCampaign, buildWhatsAppTemplate } from '@/test-utils/builders'

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
    vi.mocked(getCampaignByIdForRestaurant).mockResolvedValue(
      // #134 / I-1 round 2 (R4): buildCampaign()'s default `template` field
      // references {{code}} — override it so the baseline happy-path fixture
      // doesn't trip the inline-copy coupon guard (couponConfig is null here
      // and resolveWhatsAppTemplate defaults to null below).
      buildCampaign({
        id: CAMPAIGN_ID,
        restaurantId: RESTAURANT_ID,
        status: 'active',
        template: 'Hi {{name}}, thanks for being a member!',
      })
    )
    vi.mocked(enforceCampaignGuardrails).mockResolvedValue(undefined)
    vi.mocked(resolveWhatsAppTemplate).mockResolvedValue(null)
    vi.mocked(enforceTemplateReview).mockResolvedValue(undefined)
    vi.mocked(addCampaignJob).mockResolvedValue(undefined)
  })

  it('enqueues and returns 200 when every gate allows the send', async () => {
    const r = await POST(new Request('http://x') as never, params())
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body).toEqual({ status: 'queued' })
    expect(addCampaignJob).toHaveBeenCalledWith({
      campaignId: CAMPAIGN_ID,
      restaurantId: RESTAURANT_ID,
    })
  })

  it('runs guardrails -> template resolution -> template review -> enqueue, in that order', async () => {
    const campaign = buildCampaign({
      id: CAMPAIGN_ID,
      restaurantId: RESTAURANT_ID,
      status: 'active',
      template: 'Hi {{name}}, thanks for being a member!',
    })
    vi.mocked(getCampaignByIdForRestaurant).mockResolvedValue(campaign)
    const order: string[] = []
    vi.mocked(enforceCampaignGuardrails).mockImplementation(async () => {
      order.push('guardrails')
    })
    vi.mocked(resolveWhatsAppTemplate).mockImplementation(async () => {
      order.push('resolve-template')
      return null
    })
    vi.mocked(enforceTemplateReview).mockImplementation(async () => {
      order.push('template-review')
    })
    vi.mocked(addCampaignJob).mockImplementation(async () => {
      order.push('enqueue')
    })

    await POST(new Request('http://x') as never, params())

    expect(order).toEqual(['guardrails', 'resolve-template', 'template-review', 'enqueue'])
    expect(enforceTemplateReview).toHaveBeenCalledWith({
      campaign,
      restaurantId: RESTAURANT_ID,
      template: null,
    })
  })

  // Item 2: guardrails run synchronously with the cron's documented
  // targetMemberCount=0 (see /api/cron/campaigns/route.ts) — the real
  // count is unknown pre-enqueue; this still catches pause, daily-limit,
  // and unsubscribe-rate violations immediately instead of letting a
  // transient block burn 3 blind retries and permanently fail the campaign.
  it('checks guardrails with targetMemberCount=0, same as the cron', async () => {
    await POST(new Request('http://x') as never, params())

    expect(enforceCampaignGuardrails).toHaveBeenCalledWith(RESTAURANT_ID, 0)
  })

  it('returns 403 with violations and does NOT enqueue when guardrails block the send', async () => {
    vi.mocked(enforceCampaignGuardrails).mockRejectedValue(
      new CampaignGuardrailError(['Campaigns auto-paused by quality monitor'])
    )

    const r = await POST(new Request('http://x') as never, params())

    expect(r.status).toBe(403)
    const body = await r.json()
    expect(body).toEqual({
      error: 'Campaign blocked by guardrails',
      violations: ['Campaigns auto-paused by quality monitor'],
    })
    expect(resolveWhatsAppTemplate).not.toHaveBeenCalled()
    expect(addCampaignJob).not.toHaveBeenCalled()
  })

  it('returns 403 with violations and does NOT enqueue when the template-review gate blocks the send', async () => {
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

  // Item 3: a user-caused state (misconfigured campaign) must explain
  // itself instead of falling through to a generic 500.
  it('returns 400 with the real message when the referenced template is missing', async () => {
    vi.mocked(resolveWhatsAppTemplate).mockRejectedValue(
      new WhatsAppTemplateNotFoundError('tpl-missing')
    )

    const r = await POST(new Request('http://x') as never, params())

    expect(r.status).toBe(400)
    const body = await r.json()
    expect(body).toEqual({ error: 'WhatsApp template tpl-missing not found' })
    expect(enforceTemplateReview).not.toHaveBeenCalled()
    expect(addCampaignJob).not.toHaveBeenCalled()
  })

  it('returns 409 with the real message when the referenced template is not approved', async () => {
    vi.mocked(resolveWhatsAppTemplate).mockRejectedValue(
      new WhatsAppTemplateNotApprovedError('5th_anniversary')
    )

    const r = await POST(new Request('http://x') as never, params())

    expect(r.status).toBe(409)
    const body = await r.json()
    expect(body).toEqual({ error: 'WhatsApp template 5th_anniversary is not approved' })
    expect(addCampaignJob).not.toHaveBeenCalled()
  })

  // #127 / CAMP-007: a template declaring a media header with no usable
  // stored URL is a guaranteed Meta #132012 on every send — surface it
  // synchronously as a 409 (template state problem, like not-approved)
  // instead of queueing a run that burns and fails.
  it('returns 409 and does NOT enqueue when the template needs a media header with no stored URL', async () => {
    vi.mocked(resolveWhatsAppTemplate).mockResolvedValue(
      buildWhatsAppTemplate({
        name: 'fifth_anniversary',
        components: [
          {
            type: 'HEADER',
            format: 'IMAGE',
            example: { header_handle: ['4:aBcDeF=='] },
          },
          { type: 'BODY', text: 'Hello!' },
        ],
      })
    )

    const r = await POST(new Request('http://x') as never, params())

    expect(r.status).toBe(409)
    const body = await r.json()
    expect(body.error).toContain('fifth_anniversary')
    expect(body.error).toContain('media header')
    expect(addCampaignJob).not.toHaveBeenCalled()
  })

  // I-1 / #134: a coupon-less campaign whose template still expects a code
  // (a {{code}} body variable or a dynamic URL button) is a guaranteed Meta
  // rejection on every send — surface it synchronously as a 409 instead of
  // queueing a run that burns and fails.
  it('returns 409 and does NOT enqueue when the campaign has no coupon config but the template expects a code', async () => {
    vi.mocked(getCampaignByIdForRestaurant).mockResolvedValue(
      buildCampaign({
        id: CAMPAIGN_ID,
        restaurantId: RESTAURANT_ID,
        status: 'active',
        couponConfig: null,
      })
    )
    vi.mocked(resolveWhatsAppTemplate).mockResolvedValue(
      buildWhatsAppTemplate({
        name: 'free_drink',
        components: [{ type: 'BODY', text: 'Hi {{customer_name}}, code {{code}}' }],
      })
    )

    const r = await POST(new Request('http://x') as never, params())

    expect(r.status).toBe(409)
    const body = await r.json()
    expect(body.error).toContain('free_drink')
    expect(body.error).toContain('coupon')
    expect(addCampaignJob).not.toHaveBeenCalled()
  })

  it('enqueues when the media header has a stored https URL', async () => {
    vi.mocked(resolveWhatsAppTemplate).mockResolvedValue(
      buildWhatsAppTemplate({
        components: [
          {
            type: 'HEADER',
            format: 'IMAGE',
            example: { header_handle: ['https://cdn.example.com/pic.jpg'] },
          },
          { type: 'BODY', text: 'Hello!' },
        ],
      })
    )

    const r = await POST(new Request('http://x') as never, params())

    expect(r.status).toBe(200)
    expect(addCampaignJob).toHaveBeenCalled()
  })

  it('returns 404 when the campaign does not exist', async () => {
    vi.mocked(getCampaignByIdForRestaurant).mockResolvedValue(null)

    const r = await POST(new Request('http://x') as never, params())

    expect(r.status).toBe(404)
    expect(enforceCampaignGuardrails).not.toHaveBeenCalled()
    expect(enforceTemplateReview).not.toHaveBeenCalled()
    expect(addCampaignJob).not.toHaveBeenCalled()
  })

  // Item 1: tenant scoping. A campaign owned by another restaurant must
  // never be visible here — the scoped query resolves it to null exactly
  // like a missing id, so a cross-tenant click can't leak that tenant's
  // guardrail violations or template-review state in the 403/409 body.
  it('scopes the lookup by the caller restaurantId (never fetch-then-compare)', async () => {
    await POST(new Request('http://x') as never, params())

    expect(getCampaignByIdForRestaurant).toHaveBeenCalledWith(CAMPAIGN_ID, RESTAURANT_ID)
  })

  it('returns 404 for a cross-tenant id instead of leaking another tenant state', async () => {
    vi.mocked(getTenantContext).mockResolvedValue({
      userId: 'u-2',
      restaurantId: 'rest-2',
      role: 'admin',
      tenantStatus: 'active',
    })
    vi.mocked(getCampaignByIdForRestaurant).mockResolvedValue(null)

    const r = await POST(new Request('http://x') as never, params())

    expect(r.status).toBe(404)
    expect(getCampaignByIdForRestaurant).toHaveBeenCalledWith(CAMPAIGN_ID, 'rest-2')
    expect(enforceCampaignGuardrails).not.toHaveBeenCalled()
  })

  it('enqueues normally for a same-tenant request', async () => {
    vi.mocked(getCampaignByIdForRestaurant).mockResolvedValue(
      buildCampaign({
        id: CAMPAIGN_ID,
        restaurantId: RESTAURANT_ID,
        status: 'active',
        template: 'Hi {{name}}, thanks for being a member!',
      })
    )

    const r = await POST(new Request('http://x') as never, params())

    expect(r.status).toBe(200)
  })

  it('returns 400 when the campaign is not active, without running any gate', async () => {
    vi.mocked(getCampaignByIdForRestaurant).mockResolvedValue(
      buildCampaign({ id: CAMPAIGN_ID, restaurantId: RESTAURANT_ID, status: 'paused' })
    )

    const r = await POST(new Request('http://x') as never, params())

    expect(r.status).toBe(400)
    expect(enforceCampaignGuardrails).not.toHaveBeenCalled()
    expect(enforceTemplateReview).not.toHaveBeenCalled()
    expect(addCampaignJob).not.toHaveBeenCalled()
  })
})

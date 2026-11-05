import { describe, it, expect, vi, beforeEach } from 'vitest'

// CAMP-014: re-run messages real customers. Gates run before any write, the
// failed -> active CAS is what stops a double click, and a delivery-unknown
// failure is refused because the first send may already have gone out.

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/infrastructure/supabase/repositories/campaign-repository', () => ({
  getCampaignByIdForRestaurant: vi.fn(),
  reviveFailedCampaign: vi.fn(),
  claimCampaignForEnqueue: vi.fn(),
}))
vi.mock('@/infrastructure/queue/campaign-queue', () => ({
  addCampaignJob: vi.fn(),
}))
vi.mock('@/application/resolve-whatsapp-template', async () => {
  const actual = await vi.importActual<
    typeof import('@/application/resolve-whatsapp-template')
  >('@/application/resolve-whatsapp-template')
  return { ...actual, resolveWhatsAppTemplate: vi.fn() }
})
vi.mock('@/application/enforce-template-review', () => ({
  enforceTemplateReview: vi.fn(),
}))
vi.mock('@/application/enforce-campaign-guardrails', () => ({
  enforceCampaignGuardrails: vi.fn(),
}))

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import {
  getCampaignByIdForRestaurant,
  reviveFailedCampaign,
  claimCampaignForEnqueue,
} from '@/infrastructure/supabase/repositories/campaign-repository'
import { addCampaignJob } from '@/infrastructure/queue/campaign-queue'
import {
  resolveWhatsAppTemplate,
  WhatsAppTemplateNotFoundError,
  WhatsAppTemplateNotApprovedError,
} from '@/application/resolve-whatsapp-template'
import { enforceTemplateReview } from '@/application/enforce-template-review'
import { enforceCampaignGuardrails } from '@/application/enforce-campaign-guardrails'
import { CampaignGuardrailError } from '@/application/campaign-guardrail-error'
import { deliveryUnknownReason } from '@/domain/services/campaign-delivery-failure-reason'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { POST } from '../route'
import { POST as EXECUTE } from '../../execute/route'
import { buildCampaign, buildWhatsAppTemplate } from '@/test-utils/builders'
import type { Campaign } from '@/domain/entities/campaign'

const RESTAURANT_ID = 'rest-1'
const CAMPAIGN_ID = 'camp-1'

const params = () => ({ params: Promise.resolve({ id: CAMPAIGN_ID }) })
const call = (route = POST) => route(new Request('http://x') as never, params())

function failedCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return buildCampaign({
    id: CAMPAIGN_ID,
    restaurantId: RESTAURANT_ID,
    type: 'promo',
    status: 'failed',
    failureReason: 'WhatsApp (Meta) rejected every message in this campaign.',
    template: 'Hi {{name}}, thanks for being a member!',
    ...overrides,
  })
}

function expectNoWrites() {
  expect(reviveFailedCampaign).not.toHaveBeenCalled()
  expect(claimCampaignForEnqueue).not.toHaveBeenCalled()
  expect(addCampaignJob).not.toHaveBeenCalled()
}

describe('POST /api/dashboard/campaigns/[id]/rerun', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getTenantContext).mockResolvedValue({
      userId: 'u-1',
      restaurantId: RESTAURANT_ID,
      role: 'admin',
      tenantStatus: 'active',
    })
    vi.mocked(getCampaignByIdForRestaurant).mockResolvedValue(failedCampaign())
    vi.mocked(reviveFailedCampaign).mockResolvedValue(true)
    vi.mocked(claimCampaignForEnqueue).mockResolvedValue(true)
    vi.mocked(addCampaignJob).mockResolvedValue(undefined)
    vi.mocked(enforceCampaignGuardrails).mockResolvedValue(undefined)
    vi.mocked(resolveWhatsAppTemplate).mockResolvedValue(null)
    vi.mocked(enforceTemplateReview).mockResolvedValue(undefined)
  })

  it('revives a failed campaign, takes the lease, adds one job and answers queued', async () => {
    const r = await call()

    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ status: 'queued' })
    expect(reviveFailedCampaign).toHaveBeenCalledWith(CAMPAIGN_ID, RESTAURANT_ID)
    expect(claimCampaignForEnqueue).toHaveBeenCalledWith(CAMPAIGN_ID)
    expect(addCampaignJob).toHaveBeenCalledTimes(1)
    expect(addCampaignJob).toHaveBeenCalledWith({
      campaignId: CAMPAIGN_ID,
      restaurantId: RESTAURANT_ID,
    })
  })

  it('runs gates, then the CAS, then the lease, then the job, in that order', async () => {
    const order: string[] = []
    const track = (name: string) => order.push(name)
    vi.mocked(enforceCampaignGuardrails).mockImplementation(async () => { track('guardrails') })
    vi.mocked(resolveWhatsAppTemplate).mockImplementation(async () => { track('template'); return null })
    vi.mocked(enforceTemplateReview).mockImplementation(async () => { track('review') })
    vi.mocked(reviveFailedCampaign).mockImplementation(async () => { track('cas'); return true })
    vi.mocked(claimCampaignForEnqueue).mockImplementation(async () => { track('lease'); return true })
    vi.mocked(addCampaignJob).mockImplementation(async () => { track('job') })

    await call()

    expect(order).toEqual(['guardrails', 'template', 'review', 'cas', 'lease', 'job'])
  })

  it('scopes the lookup to the tenant: a cross-tenant id is 404 with no writes', async () => {
    vi.mocked(getCampaignByIdForRestaurant).mockResolvedValue(null)

    const r = await call()

    expect(r.status).toBe(404)
    expect(getCampaignByIdForRestaurant).toHaveBeenCalledWith(CAMPAIGN_ID, RESTAURANT_ID)
    expect(enforceCampaignGuardrails).not.toHaveBeenCalled()
    expectNoWrites()
  })

  it.each(['draft', 'active', 'sending', 'paused', 'completed'] as const)(
    'rejects a %s campaign with 400 and no writes',
    async (status) => {
      vi.mocked(getCampaignByIdForRestaurant).mockResolvedValue(
        failedCampaign({ status, failureReason: null })
      )

      const r = await call()

      expect(r.status).toBe(400)
      expectNoWrites()
    }
  )

  it('rejects a welcome campaign with 400 and no writes', async () => {
    vi.mocked(getCampaignByIdForRestaurant).mockResolvedValue(failedCampaign({ type: 'welcome' }))

    const r = await call()

    expect(r.status).toBe(400)
    expectNoWrites()
  })

  it('refuses a delivery-unknown failure with 409, no status change and no job', async () => {
    vi.mocked(getCampaignByIdForRestaurant).mockResolvedValue(
      failedCampaign({ failureReason: deliveryUnknownReason(5, 2) })
    )

    const r = await call()

    expect(r.status).toBe(409)
    expect((await r.json()).error).toMatch(/support/i)
    expect(enforceCampaignGuardrails).not.toHaveBeenCalled()
    expectNoWrites()
  })

  it('a lost CAS is 409 with no lease and no job (double click)', async () => {
    vi.mocked(reviveFailedCampaign).mockResolvedValue(false)

    const r = await call()

    expect(r.status).toBe(409)
    expect(claimCampaignForEnqueue).not.toHaveBeenCalled()
    expect(addCampaignJob).not.toHaveBeenCalled()
  })

  it('a lost lease answers queued and adds no job', async () => {
    vi.mocked(claimCampaignForEnqueue).mockResolvedValue(false)

    const r = await call()

    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ status: 'queued' })
    expect(addCampaignJob).not.toHaveBeenCalled()
  })

  it('answers 500 with a generic message when the job cannot be added', async () => {
    vi.mocked(addCampaignJob).mockRejectedValue(new Error('redis://secret-host down'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const r = await call()

    expect(r.status).toBe(500)
    expect(JSON.stringify(await r.json())).not.toContain('secret-host')
    errSpy.mockRestore()
  })

  it('maps an auth failure to its own status', async () => {
    vi.mocked(getTenantContext).mockRejectedValue(new AuthError('Unauthorized', 401))

    const r = await call()

    expect(r.status).toBe(401)
    expectNoWrites()
  })

  // Parity by construction: both routes are driven through the same failing
  // gate and must answer byte-identically, and /rerun must not have written.
  describe('gate errors match /execute and leave the campaign failed', () => {
    const headerTemplate = buildWhatsAppTemplate({
      name: 'no_media',
      components: [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'Hi' }],
    })
    const codeTemplate = buildWhatsAppTemplate({
      name: 'needs_code',
      components: [{ type: 'BODY', text: 'Use {{code}}' }],
    })
    const cases: Array<[string, number, () => void]> = [
      ['guardrails', 403, () => {
        vi.mocked(enforceCampaignGuardrails).mockRejectedValue(
          new CampaignGuardrailError(['Paused'])
        )
      }],
      ['template review', 403, () => {
        vi.mocked(enforceTemplateReview).mockRejectedValue(
          new CampaignGuardrailError(['Review required'])
        )
      }],
      ['template not found', 400, () => {
        vi.mocked(resolveWhatsAppTemplate).mockRejectedValue(new WhatsAppTemplateNotFoundError('t-1'))
      }],
      ['template not approved', 409, () => {
        vi.mocked(resolveWhatsAppTemplate).mockRejectedValue(new WhatsAppTemplateNotApprovedError('t-1'))
      }],
      ['header media missing', 409, () => {
        vi.mocked(resolveWhatsAppTemplate).mockResolvedValue(headerTemplate)
      }],
      ['coupon config missing', 409, () => {
        vi.mocked(resolveWhatsAppTemplate).mockResolvedValue(codeTemplate)
      }],
    ]

    it.each(cases)('%s answers %i on both routes', async (_name, status, arrange) => {
      arrange()
      vi.mocked(getCampaignByIdForRestaurant).mockResolvedValue(failedCampaign({ couponConfig: null }))
      const rerun = await call()
      expectNoWrites()

      vi.mocked(getCampaignByIdForRestaurant).mockResolvedValue(
        failedCampaign({ couponConfig: null, status: 'active', failureReason: null })
      )
      const execute = await call(EXECUTE)

      expect(rerun.status).toBe(status)
      expect(execute.status).toBe(status)
      expect(await rerun.json()).toEqual(await execute.json())
    })
  })
})

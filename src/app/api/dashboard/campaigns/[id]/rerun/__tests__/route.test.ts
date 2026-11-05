import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// CAMP-014: re-run messages real customers. Gates run before any write, the
// failed -> active CAS is what stops a double click, and a delivery-unknown
// failure is refused because the first send may already have gone out.

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/infrastructure/supabase/repositories/campaign-repository', () => ({
  getCampaignByIdForRestaurant: vi.fn(),
  reviveFailedCampaign: vi.fn(),
  claimCampaignForEnqueue: vi.fn(),
  stampCampaignEnqueued: vi.fn(),
  restoreCampaignFailure: vi.fn(),
}))
vi.mock('@/infrastructure/queue/campaign-queue', () => ({
  addCampaignJob: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/whatsapp-message-campaign-queries', () => ({
  countCampaignBodyRows: vi.fn(),
  countFailedBodyRowsWithoutMetaCode: vi.fn(),
  countQueuedBodyRowsWithoutWamid: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/coupon-campaign-queries', () => ({
  countExpiredCampaignCoupons: vi.fn(),
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
  stampCampaignEnqueued,
  restoreCampaignFailure,
} from '@/infrastructure/supabase/repositories/campaign-repository'
import { addCampaignJob } from '@/infrastructure/queue/campaign-queue'
import {
  countCampaignBodyRows,
  countFailedBodyRowsWithoutMetaCode,
  countQueuedBodyRowsWithoutWamid,
} from '@/infrastructure/supabase/repositories/whatsapp-message-campaign-queries'
import { countExpiredCampaignCoupons } from '@/infrastructure/supabase/repositories/coupon-campaign-queries'
import {
  resolveWhatsAppTemplate,
  WhatsAppTemplateNotFoundError,
  WhatsAppTemplateNotApprovedError,
} from '@/application/resolve-whatsapp-template'
import { enforceTemplateReview } from '@/application/enforce-template-review'
import { enforceCampaignGuardrails } from '@/application/enforce-campaign-guardrails'
import { CampaignGuardrailError } from '@/application/campaign-guardrail-error'
import {
  deliveryFailureReason,
  deliveryUnknownReason,
} from '@/domain/services/campaign-delivery-failure-reason'
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
  expect(stampCampaignEnqueued).not.toHaveBeenCalled()
  expect(restoreCampaignFailure).not.toHaveBeenCalled()
  expect(addCampaignJob).not.toHaveBeenCalled()
}

describe('POST /api/dashboard/campaigns/[id]/rerun', () => {
  const ORIGINAL_FLAG = process.env.WAQ_TRACK_MESSAGES

  afterEach(() => {
    if (ORIGINAL_FLAG === undefined) delete process.env.WAQ_TRACK_MESSAGES
    else process.env.WAQ_TRACK_MESSAGES = ORIGINAL_FLAG
  })

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.WAQ_TRACK_MESSAGES
    // Default evidence: a ledger exists and every failure carries Meta's code.
    vi.mocked(countCampaignBodyRows).mockResolvedValue(250)
    vi.mocked(countFailedBodyRowsWithoutMetaCode).mockResolvedValue(0)
    vi.mocked(countQueuedBodyRowsWithoutWamid).mockResolvedValue(0)
    vi.mocked(countExpiredCampaignCoupons).mockResolvedValue(0)
    vi.mocked(stampCampaignEnqueued).mockResolvedValue(undefined)
    vi.mocked(restoreCampaignFailure).mockResolvedValue(true)
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
    vi.mocked(countCampaignBodyRows).mockImplementation(async () => { track('evidence'); return 1 })
    vi.mocked(enforceCampaignGuardrails).mockImplementation(async () => { track('guardrails') })
    vi.mocked(resolveWhatsAppTemplate).mockImplementation(async () => { track('template'); return null })
    vi.mocked(enforceTemplateReview).mockImplementation(async () => { track('review') })
    vi.mocked(reviveFailedCampaign).mockImplementation(async () => { track('cas'); return true })
    vi.mocked(claimCampaignForEnqueue).mockImplementation(async () => { track('lease'); return true })
    vi.mocked(addCampaignJob).mockImplementation(async () => { track('job') })

    await call()

    expect(order).toEqual(['evidence', 'guardrails', 'template', 'review', 'cas', 'lease', 'job'])
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

  it('refuses a 131047 failure with 409 and no writes: the template cannot reach them', async () => {
    vi.mocked(getCampaignByIdForRestaurant).mockResolvedValue(
      failedCampaign({ failureReason: deliveryFailureReason('131047', null, null) })
    )

    const r = await call()

    expect(r.status).toBe(409)
    expect((await r.json()).error).toMatch(/new campaign/i)
    expect(countCampaignBodyRows).not.toHaveBeenCalled()
    expectNoWrites()
  })

  // Re-run may only proceed when our rows prove Meta definitively rejected the
  // earlier sends. Each refusal happens before gates, so nothing was written.
  describe('row-evidence guard', () => {
    function expectRefusedUntouched() {
      expect(enforceCampaignGuardrails).not.toHaveBeenCalled()
      expectNoWrites()
    }

    it('tracking off: no ledger can skip anyone, 409 naming OhMyClient, no query', async () => {
      process.env.WAQ_TRACK_MESSAGES = '0'

      const r = await call()

      expect(r.status).toBe(409)
      const { error } = await r.json()
      expect(error).toContain('OhMyClient')
      expect(error).toMatch(/twice/)
      expect(error).toMatch(/support/i)
      expect(countCampaignBodyRows).not.toHaveBeenCalled()
      expectRefusedUntouched()
    })

    it('zero body rows: no ledger exists, 409', async () => {
      vi.mocked(countCampaignBodyRows).mockResolvedValue(0)

      const r = await call()

      expect(r.status).toBe(409)
      expect((await r.json()).error).toContain('OhMyClient')
      expect(countCampaignBodyRows).toHaveBeenCalledWith({
        campaignId: CAMPAIGN_ID,
        restaurantId: RESTAURANT_ID,
      })
      expectRefusedUntouched()
    })

    it('one failed body row with no Meta code among many: 409', async () => {
      vi.mocked(countFailedBodyRowsWithoutMetaCode).mockResolvedValue(1)

      const r = await call()

      expect(r.status).toBe(409)
      expect((await r.json()).error).toContain('OhMyClient')
      expect(countFailedBodyRowsWithoutMetaCode).toHaveBeenCalledWith({
        campaignId: CAMPAIGN_ID,
        restaurantId: RESTAURANT_ID,
      })
      expectRefusedUntouched()
    })

    it('one body row queued with no wamid among many: 409', async () => {
      vi.mocked(countQueuedBodyRowsWithoutWamid).mockResolvedValue(1)

      const r = await call()

      expect(r.status).toBe(409)
      expect((await r.json()).error).toContain('OhMyClient')
      expect(countQueuedBodyRowsWithoutWamid).toHaveBeenCalledWith({
        campaignId: CAMPAIGN_ID,
        restaurantId: RESTAURANT_ID,
      })
      expectRefusedUntouched()
    })

    it('an expired coupon: 409 saying to create a new campaign', async () => {
      vi.mocked(countExpiredCampaignCoupons).mockResolvedValue(1)

      const r = await call()

      expect(r.status).toBe(409)
      const { error } = await r.json()
      expect(error).toMatch(/expired/i)
      expect(error).toMatch(/new campaign/i)
      expect(countExpiredCampaignCoupons).toHaveBeenCalledWith({
        campaignId: CAMPAIGN_ID,
        restaurantId: RESTAURANT_ID,
      })
      expectRefusedUntouched()
    })

    it('every failure carrying a Meta code proceeds', async () => {
      const r = await call()

      expect(r.status).toBe(200)
      expect(reviveFailedCampaign).toHaveBeenCalledTimes(1)
      expect(addCampaignJob).toHaveBeenCalledTimes(1)
    })

    it.each([
      ['the body-row count', () => vi.mocked(countCampaignBodyRows)],
      ['the no-code count', () => vi.mocked(countFailedBodyRowsWithoutMetaCode)],
      ['the queued-no-wamid count', () => vi.mocked(countQueuedBodyRowsWithoutWamid)],
      ['the coupon count', () => vi.mocked(countExpiredCampaignCoupons)],
    ])('a query error in %s fails closed: 500 with no write', async (_name, mock) => {
      mock().mockRejectedValue(new Error('db://secret-host down'))
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const r = await call()

      expect(r.status).toBe(500)
      expect(JSON.stringify(await r.json())).not.toContain('secret-host')
      expectRefusedUntouched()
      errSpy.mockRestore()
    })
  })

  it('a lost CAS is 409 with no lease and no job (double click)', async () => {
    vi.mocked(reviveFailedCampaign).mockResolvedValue(false)

    const r = await call()

    expect(r.status).toBe(409)
    expect(claimCampaignForEnqueue).not.toHaveBeenCalled()
    expect(addCampaignJob).not.toHaveBeenCalled()
  })

  describe('lost lease', () => {
    beforeEach(() => {
      vi.mocked(claimCampaignForEnqueue).mockResolvedValue(false)
    })

    it('unscheduled: no cron can pick it up, so it stamps and adds one job', async () => {
      const order: string[] = []
      vi.mocked(stampCampaignEnqueued).mockImplementation(async () => { order.push('stamp') })
      vi.mocked(addCampaignJob).mockImplementation(async () => { order.push('job') })

      const r = await call()

      expect(r.status).toBe(200)
      expect(await r.json()).toEqual({ status: 'queued' })
      expect(stampCampaignEnqueued).toHaveBeenCalledWith(CAMPAIGN_ID, RESTAURANT_ID)
      expect(addCampaignJob).toHaveBeenCalledTimes(1)
      expect(order).toEqual(['stamp', 'job'])
    })

    it('scheduled: adds no job and answers queued, the cron enqueues once the lease lapses', async () => {
      vi.mocked(getCampaignByIdForRestaurant).mockResolvedValue(
        failedCampaign({ scheduledAt: '2026-11-04T07:30:00Z' })
      )

      const r = await call()

      expect(r.status).toBe(200)
      expect(await r.json()).toEqual({ status: 'queued' })
      expect(stampCampaignEnqueued).not.toHaveBeenCalled()
      expect(addCampaignJob).not.toHaveBeenCalled()
    })
  })

  describe('a failure after the CAS reverts to failed with the original reason', () => {
    const REASON = 'WhatsApp (Meta) rejected every message in this campaign.'
    let errSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    })
    afterEach(() => errSpy.mockRestore())

    it('job error: 500 with a generic message and the reason restored for this tenant', async () => {
      vi.mocked(addCampaignJob).mockRejectedValue(new Error('redis://secret-host down'))

      const r = await call()

      expect(r.status).toBe(500)
      expect(JSON.stringify(await r.json())).not.toContain('secret-host')
      expect(restoreCampaignFailure).toHaveBeenCalledWith(CAMPAIGN_ID, RESTAURANT_ID, REASON)
    })

    it('lease error: 500, reason restored, no job', async () => {
      vi.mocked(claimCampaignForEnqueue).mockRejectedValue(new Error('db down'))

      const r = await call()

      expect(r.status).toBe(500)
      expect(restoreCampaignFailure).toHaveBeenCalledWith(CAMPAIGN_ID, RESTAURANT_ID, REASON)
      expect(addCampaignJob).not.toHaveBeenCalled()
    })

    it('stamp error on a lost lease: 500, reason restored, no job', async () => {
      vi.mocked(claimCampaignForEnqueue).mockResolvedValue(false)
      vi.mocked(stampCampaignEnqueued).mockRejectedValue(new Error('db down'))

      const r = await call()

      expect(r.status).toBe(500)
      expect(restoreCampaignFailure).toHaveBeenCalledWith(CAMPAIGN_ID, RESTAURANT_ID, REASON)
      expect(addCampaignJob).not.toHaveBeenCalled()
    })

    it('revert error: still 500, logged at error with the campaign id', async () => {
      vi.mocked(addCampaignJob).mockRejectedValue(new Error('redis down'))
      vi.mocked(restoreCampaignFailure).mockRejectedValue(new Error('db down'))

      const r = await call()

      expect(r.status).toBe(500)
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining('revert'),
        expect.objectContaining({ campaignId: CAMPAIGN_ID })
      )
    })

    it('revert matching no active row: still 500, logged at error with the campaign id', async () => {
      vi.mocked(addCampaignJob).mockRejectedValue(new Error('redis down'))
      vi.mocked(restoreCampaignFailure).mockResolvedValue(false)

      const r = await call()

      expect(r.status).toBe(500)
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining('revert'),
        expect.objectContaining({ campaignId: CAMPAIGN_ID })
      )
    })

    it('a refusal or gate error never reverts: nothing was revived', async () => {
      vi.mocked(enforceCampaignGuardrails).mockRejectedValue(new CampaignGuardrailError(['Paused']))

      const r = await call()

      expect(r.status).toBe(403)
      expect(restoreCampaignFailure).not.toHaveBeenCalled()
    })
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

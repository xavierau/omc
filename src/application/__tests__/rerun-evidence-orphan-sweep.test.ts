import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// CAMP-014 C2, end to end. Kapso accepts a send and Meta delivers it, but saving the
// wamid fails, so the row stays queued until the sweep marks it failed/internal_orphan.
// The ledger stops counting it at that moment, so the evidence guard is the only thing
// between a tenant click and a second message. Real send pipeline, message repository,
// sweep, ledger, guard and route over an in-memory whatsapp_messages table; only the
// SDK, the campaign row, the queue and the pre-send gates are stubbed.

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  sendTemplate: vi.fn(),
}))

vi.mock('@kapso/whatsapp-cloud-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@kapso/whatsapp-cloud-api')>()
  class FakeClient {
    messages = { sendTemplate: h.sendTemplate }
  }
  return { ...actual, WhatsAppClient: FakeClient }
})

vi.mock('@/infrastructure/supabase/client', () => ({
  createServerSupabaseClient: () => ({
    from: (table: string) =>
      fakeTable(table === 'whatsapp_messages' ? h.rows : [], {
        updateError: (patch, matched) =>
          'kapso_message_id' in patch && matched.some((row) => row.member_id === 'm-2')
            ? 'statement timeout'
            : null,
      }),
  }),
}))

vi.mock('@/infrastructure/supabase/guards/tenant-guard', () => ({
  getTenantContext: vi.fn(),
}))
vi.mock('@/infrastructure/queue/campaign-queue', () => ({
  addCampaignJob: vi.fn(),
}))
vi.mock('@/application/enforce-campaign-send-gates', () => ({
  enforceCampaignSendGates: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/infrastructure/supabase/repositories/campaign-repository', () => ({
  getCampaignById: vi.fn(),
  getCampaignByIdForRestaurant: vi.fn(),
  reviveFailedCampaign: vi.fn(),
  claimCampaignForEnqueue: vi.fn(),
  stampCampaignEnqueued: vi.fn(),
  restoreCampaignFailure: vi.fn(),
  incrementCampaignSent: vi.fn(),
  updateCampaign: vi.fn(),
  transitionCampaignStatus: vi.fn(),
  completeCampaignRunIfCounted: vi.fn(),
  failCampaignRunIfSending: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/restaurant-repository', () => ({
  getRestaurantPhoneNumberId: vi.fn().mockResolvedValue('phone-id-1'),
}))
vi.mock('@/infrastructure/supabase/repositories/restaurant-onboarding-repository', () => ({
  getRestaurantDefaultLanguage: vi.fn().mockResolvedValue('zh_hk'),
}))
vi.mock('@/infrastructure/supabase/repositories/campaign-settings-repository', () => ({
  getSettingsForTenant: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/infrastructure/supabase/repositories/consent-record-repository', () => ({
  findActiveConsent: vi.fn(),
  findActiveMarketingConsentForPhones: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/whatsapp-message-cooldown-queries', () => ({
  countMarketingSendsLast24h: vi.fn().mockResolvedValue(0),
  countMarketingSendsLast24hForPhones: vi.fn().mockResolvedValue(new Map()),
}))
vi.mock('@/infrastructure/supabase/repositories/whatsapp-template-repository', () => ({
  findTemplateByIdForRestaurant: vi.fn(),
}))
vi.mock('@/application/resolve-campaign-members', () => ({
  resolveTargetMembers: vi.fn(),
}))
vi.mock('@/application/check-campaign-guardrails', () => ({
  checkCampaignGuardrails: vi.fn().mockResolvedValue({ allowed: true, violations: [], warnings: [] }),
}))
vi.mock('@/application/enforce-template-review', () => ({
  enforceTemplateReview: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/application/emit-event', () => ({ emitEvent: vi.fn() }))

import { fakeTable } from '@/test-utils/fake-postgrest-table'
import { executeCampaign } from '@/application/execute-campaign'
import { findRerunEvidenceRefusal } from '@/application/rerun-evidence-guard'
import { reconcileOrphanMessages } from '@/application/reconcile-orphan-messages'
import { deliveryFailureReason } from '@/domain/services/campaign-delivery-failure-reason'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { addCampaignJob } from '@/infrastructure/queue/campaign-queue'
import {
  claimCampaignForEnqueue,
  getCampaignById,
  getCampaignByIdForRestaurant,
  reviveFailedCampaign,
  transitionCampaignStatus,
} from '@/infrastructure/supabase/repositories/campaign-repository'
import { findTemplateByIdForRestaurant } from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { findActiveMarketingConsentForPhones } from '@/infrastructure/supabase/repositories/consent-record-repository'
import { resolveTargetMembers } from '@/application/resolve-campaign-members'
import { ConsentRecord } from '@/domain/entities/consent-record'
import { buildCampaign, buildWhatsAppTemplate, buildMember } from '@/test-utils/builders'
import { POST } from '@/app/api/dashboard/campaigns/[id]/rerun/route'

const MEMBERS = [
  buildMember({ id: 'm-1', restaurantId: 'r-1', phone: '85291111111' }),
  buildMember({ id: 'm-2', restaurantId: 'r-1', phone: '85292222222' }),
]
const CAMPAIGN = buildCampaign({
  id: 'camp-1',
  restaurantId: 'r-1',
  whatsappTemplateId: 'tpl-1',
  couponConfig: null,
})

const sendsToM2 = () =>
  h.sendTemplate.mock.calls.filter((call) => JSON.stringify(call).includes('85292222222')).length
const rowOf = (memberId: string) => h.rows.find((row) => row.member_id === memberId)!
const META_REJECTED = {
  status: 'failed',
  error_code: '131042',
  error_details: 'payment has been restricted',
}
const tenantClicksRerun = () =>
  POST(new Request('http://x') as never, { params: Promise.resolve({ id: 'camp-1' }) })

describe('rerun evidence after the orphan sweep', () => {
  const ORIGINAL_KEY = process.env.KAPSO_API_KEY

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    h.rows.length = 0
    process.env.KAPSO_API_KEY = 'test-key'
    h.sendTemplate.mockResolvedValue({ messages: [{ id: 'wamid.ok' }] })
    vi.mocked(getTenantContext).mockResolvedValue({
      userId: 'u-1',
      restaurantId: 'r-1',
      role: 'admin',
      tenantStatus: 'active',
    })
    vi.mocked(getCampaignById).mockResolvedValue(CAMPAIGN)
    vi.mocked(getCampaignByIdForRestaurant).mockResolvedValue({
      ...CAMPAIGN,
      status: 'failed',
      failureReason: deliveryFailureReason('131042', 'x', 'payment has been restricted'),
    })
    vi.mocked(reviveFailedCampaign).mockResolvedValue(true)
    vi.mocked(claimCampaignForEnqueue).mockResolvedValue(true)
    vi.mocked(transitionCampaignStatus).mockResolvedValue(true)
    vi.mocked(resolveTargetMembers).mockResolvedValue(MEMBERS)
    // The queue delivers: an accepted re-run really does reach the send pipeline.
    vi.mocked(addCampaignJob).mockImplementation(async () => {
      await executeCampaign('camp-1', 'r-1')
    })
    vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue(
      buildWhatsAppTemplate({
        id: 'tpl-1',
        restaurantId: 'r-1',
        status: 'approved',
        category: 'UTILITY',
        components: [{ type: 'BODY', text: 'Hello!' }],
      })
    )
    vi.mocked(findActiveMarketingConsentForPhones).mockResolvedValue(
      new Map<string, ConsentRecord>()
    )

    await executeCampaign('camp-1', 'r-1')
    expect(sendsToM2()).toBe(1)
    expect(rowOf('m-2').status).toBe('queued')
  })

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.KAPSO_API_KEY
    else process.env.KAPSO_API_KEY = ORIGINAL_KEY
    vi.restoreAllMocks()
  })

  it('a row swept to internal_orphan refuses the re-run, so the member is not sent again', async () => {
    rowOf('m-2').queued_at = new Date(Date.now() - 6 * 60_000).toISOString()
    await expect(reconcileOrphanMessages()).resolves.toEqual({ swept: 1 })
    expect(rowOf('m-2')).toMatchObject({ status: 'failed', error_code: 'internal_orphan' })
    Object.assign(rowOf('m-1'), META_REJECTED)

    await expect(findRerunEvidenceRefusal(CAMPAIGN)).resolves.toBe('delivery_unconfirmed')
    const response = await tenantClicksRerun()

    expect(response.status).toBe(409)
    expect(reviveFailedCampaign).not.toHaveBeenCalled()
    expect(addCampaignJob).not.toHaveBeenCalled()
    expect(sendsToM2()).toBe(1)
  })

  // The control: the same click reaches the customer once Meta decided every row,
  // so the refusal above is the guard's doing and not a broken harness.
  it('proceeds and re-sends when Meta decided every failed row', async () => {
    Object.assign(rowOf('m-1'), META_REJECTED)
    Object.assign(rowOf('m-2'), META_REJECTED)

    const response = await tenantClicksRerun()

    expect(response.status).toBe(200)
    expect(addCampaignJob).toHaveBeenCalledTimes(1)
    expect(sendsToM2()).toBe(2)
  })
})

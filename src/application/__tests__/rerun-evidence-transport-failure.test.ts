import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// CAMP-014 C1, end to end. The Kapso call rejects the way a gateway timeout does:
// the request may have reached Meta, so the outcome is unknown. Real send
// pipeline, real message repository and real count queries over an in-memory
// whatsapp_messages table; only the SDK, the campaign row and the
// pre-send gates are stubbed. The row the pipeline writes must be the row the
// guard refuses on.

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
    from: (table: string) => {
      const rows = table === 'whatsapp_messages' ? h.rows : []
      return fakeTable(rows)
    },
  }),
}))

vi.mock('@/infrastructure/supabase/repositories/campaign-repository', () => ({
  getCampaignById: vi.fn(),
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
import { rerunBlock } from '@/domain/services/campaign-rerun'
import {
  getCampaignById,
  transitionCampaignStatus,
  updateCampaign,
} from '@/infrastructure/supabase/repositories/campaign-repository'
import { findTemplateByIdForRestaurant } from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { findActiveMarketingConsentForPhones } from '@/infrastructure/supabase/repositories/consent-record-repository'
import { resolveTargetMembers } from '@/application/resolve-campaign-members'
import { ConsentRecord } from '@/domain/entities/consent-record'
import { buildCampaign, buildWhatsAppTemplate, buildMember } from '@/test-utils/builders'

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

describe('rerun after a Kapso transport failure', () => {
  const ORIGINAL_KEY = process.env.KAPSO_API_KEY
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

  beforeEach(() => {
    vi.clearAllMocks()
    h.rows.length = 0
    process.env.KAPSO_API_KEY = 'test-key'
    h.sendTemplate.mockRejectedValue(new TypeError('fetch failed'))
    vi.mocked(getCampaignById).mockResolvedValue(CAMPAIGN)
    vi.mocked(transitionCampaignStatus).mockResolvedValue(true)
    vi.mocked(resolveTargetMembers).mockResolvedValue(MEMBERS)
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
  })

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.KAPSO_API_KEY
    else process.env.KAPSO_API_KEY = ORIGINAL_KEY
    warn.mockClear()
  })

  it('leaves every row failed with a null error_code, and the guard refuses', async () => {
    await executeCampaign('camp-1', 'r-1')

    expect(h.sendTemplate).toHaveBeenCalledTimes(MEMBERS.length)
    expect(h.rows).toHaveLength(MEMBERS.length)
    for (const row of h.rows) {
      expect(row.status).toBe('failed')
      expect(row.error_code ?? null).toBeNull()
      expect(row.error_title).toBe('kapso_send_error')
    }

    const write = vi
      .mocked(updateCampaign)
      .mock.calls.find(([, changes]) => changes.status === 'failed')
    // The stored reason alone would let this through. The rows are what refuse.
    expect(rerunBlock({ ...CAMPAIGN, status: 'failed', failureReason: write?.[1].failureReason })).toBeNull()
    await expect(findRerunEvidenceRefusal(CAMPAIGN)).resolves.toBe('delivery_unconfirmed')
  })

  it('proceeds once every failed row carries the code Meta decided with', async () => {
    await executeCampaign('camp-1', 'r-1')
    h.rows.forEach((row) => { row.error_code = '131042' })

    await expect(findRerunEvidenceRefusal(CAMPAIGN)).resolves.toBeNull()
  })
})

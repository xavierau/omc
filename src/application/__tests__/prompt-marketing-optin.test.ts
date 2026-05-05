import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/member-repository', () => ({
  findMemberByPhone: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/consent-record-repository', () => ({
  findActiveConsent: vi.fn(),
  insertConsentRecord: vi.fn(),
}))
vi.mock(
  '@/infrastructure/supabase/repositories/optin-template-repository',
  () => ({
    findOptinTemplateOverride: vi.fn(),
    findRecentPendingMarketingConsent: vi.fn(),
  })
)
vi.mock(
  '@/infrastructure/supabase/repositories/whatsapp-template-repository',
  () => ({
    findTemplateById: vi.fn(),
  })
)
vi.mock('@/infrastructure/supabase/repositories/restaurant-repository', () => ({
  getRestaurantPhoneNumberId: vi.fn(),
}))
vi.mock('@/application/send-template-message', () => ({
  sendWhatsAppTemplateMessage: vi.fn(),
}))

import { promptMarketingOptin } from '../prompt-marketing-optin'
import { findMemberByPhone } from '@/infrastructure/supabase/repositories/member-repository'
import {
  findActiveConsent,
  insertConsentRecord,
} from '@/infrastructure/supabase/repositories/consent-record-repository'
import {
  findOptinTemplateOverride,
  findRecentPendingMarketingConsent,
} from '@/infrastructure/supabase/repositories/optin-template-repository'
import { findTemplateById } from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { getRestaurantPhoneNumberId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { sendWhatsAppTemplateMessage } from '@/application/send-template-message'
import { ConsentRecord } from '@/domain/entities/consent-record'
import { ConsentImportError } from '@/domain/repositories/consent-record-repository'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'

const MEMBER = { id: 'm-1', pointsBalance: 0, preferredLanguage: null }
const TEMPLATE: WhatsAppTemplate = {
  id: 't-default',
  restaurantId: 'r-1',
  metaTemplateId: 'meta-x',
  name: 'optin_confirmation',
  language: 'en',
  category: 'UTILITY',
  status: 'approved',
  components: [{ type: 'BODY', text: 'Reply YES to receive offers.' }],
  parameterFormat: 'NAMED',
  rejectionReason: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const ENV_KEY = 'KAPSO_DEFAULT_OPTIN_TEMPLATE_ID'
const ORIGINAL_ENV = process.env[ENV_KEY]

describe('promptMarketingOptin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env[ENV_KEY] = 't-default'
    vi.mocked(findMemberByPhone).mockResolvedValue(MEMBER)
    vi.mocked(findActiveConsent).mockResolvedValue(null)
    vi.mocked(findRecentPendingMarketingConsent).mockResolvedValue(null)
    vi.mocked(findOptinTemplateOverride).mockResolvedValue(null)
    vi.mocked(findTemplateById).mockResolvedValue(TEMPLATE)
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('pn-1')
    vi.mocked(insertConsentRecord).mockResolvedValue(undefined)
    vi.mocked(sendWhatsAppTemplateMessage).mockResolvedValue({
      success: true,
    } as never)
  })

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env[ENV_KEY]
    else process.env[ENV_KEY] = ORIGINAL_ENV
  })

  it('happy path: inserts pending row and sends the platform-default template', async () => {
    const r = await promptMarketingOptin({
      restaurantId: 'r-1',
      phoneE164: '85291111111',
      source: 'inbound_first_wamid.A1',
    })

    expect(r).toEqual({ promptSent: true })
    expect(insertConsentRecord).toHaveBeenCalledTimes(1)
    const inserted = vi.mocked(insertConsentRecord).mock.calls[0][0]
    expect(inserted.snapshot.status).toBe('pending')
    expect(inserted.snapshot.consentGrade).toBe('strong')
    expect(inserted.snapshot.source).toBe('inbound_first_wamid.A1')
    expect(inserted.snapshot.memberId).toBe('m-1')

    expect(findTemplateById).toHaveBeenCalledWith('t-default')
    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledTimes(1)
  })

  it('uses tenant override when configured', async () => {
    vi.mocked(findOptinTemplateOverride).mockResolvedValue('t-tenant')
    const tenantTemplate = { ...TEMPLATE, id: 't-tenant', name: 'optin_zh' }
    vi.mocked(findTemplateById).mockResolvedValue(tenantTemplate)

    await promptMarketingOptin({
      restaurantId: 'r-1',
      phoneE164: '85291111111',
      source: 'inbound_first_wamid.A1',
    })

    expect(findTemplateById).toHaveBeenCalledWith('t-tenant')
  })

  it('skips with no_member when phone is unknown to the tenant', async () => {
    vi.mocked(findMemberByPhone).mockResolvedValue(null)

    const r = await promptMarketingOptin({
      restaurantId: 'r-1',
      phoneE164: '85291111111',
      source: 'inbound_first_wamid.A1',
    })

    expect(r).toEqual({ promptSent: false, reason: 'no_member' })
    expect(insertConsentRecord).not.toHaveBeenCalled()
    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled()
  })

  it('skips with has_strong_consent when an opted_in/strong record exists', async () => {
    const opted = ConsentRecord.grant({
      id: 'c-1',
      restaurantId: 'r-1',
      memberId: 'm-1',
      phoneE164: '85291111111',
      category: 'marketing',
      source: 'website_form',
      grade: 'strong',
    })
    vi.mocked(findActiveConsent).mockResolvedValue(opted)

    const r = await promptMarketingOptin({
      restaurantId: 'r-1',
      phoneE164: '85291111111',
      source: 'inbound_first_wamid.A1',
    })

    expect(r).toEqual({ promptSent: false, reason: 'has_strong_consent' })
    expect(insertConsentRecord).not.toHaveBeenCalled()
    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled()
  })

  it('skips with recent_pending when a pending row was captured within 7d', async () => {
    const pending = ConsentRecord.markPending({
      id: 'c-pending',
      restaurantId: 'r-1',
      memberId: 'm-1',
      phoneE164: '85291111111',
      category: 'marketing',
      source: 'inbound_first_optin',
    })
    vi.mocked(findRecentPendingMarketingConsent).mockResolvedValue(pending)

    const r = await promptMarketingOptin({
      restaurantId: 'r-1',
      phoneE164: '85291111111',
      source: 'inbound_first_wamid.A1',
    })

    expect(r).toEqual({ promptSent: false, reason: 'recent_pending' })
    expect(insertConsentRecord).not.toHaveBeenCalled()
    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled()
  })

  it('skips with template_unset when no override and env is missing', async () => {
    delete process.env[ENV_KEY]

    const r = await promptMarketingOptin({
      restaurantId: 'r-1',
      phoneE164: '85291111111',
      source: 'inbound_first_wamid.A1',
    })

    expect(r).toEqual({ promptSent: false, reason: 'template_unset' })
    expect(insertConsentRecord).not.toHaveBeenCalled()
    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled()
  })

  it('skips with template_missing when the configured id resolves to no row', async () => {
    vi.mocked(findTemplateById).mockResolvedValue(null)

    const r = await promptMarketingOptin({
      restaurantId: 'r-1',
      phoneE164: '85291111111',
      source: 'inbound_first_wamid.A1',
    })

    expect(r).toEqual({ promptSent: false, reason: 'template_missing' })
    expect(insertConsentRecord).not.toHaveBeenCalled()
    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled()
  })

  it('skips with template_not_utility when the configured template is MARKETING category', async () => {
    vi.mocked(findTemplateById).mockResolvedValue({
      ...TEMPLATE,
      category: 'MARKETING',
    })

    const r = await promptMarketingOptin({
      restaurantId: 'r-1',
      phoneE164: '85291111111',
      source: 'inbound_first_wamid.A1',
    })

    expect(r).toEqual({ promptSent: false, reason: 'template_not_utility' })
    expect(insertConsentRecord).not.toHaveBeenCalled()
    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled()
  })

  it('skips with race_lost when insertConsentRecord throws ConsentImportError(duplicate_active)', async () => {
    vi.mocked(insertConsentRecord).mockRejectedValueOnce(
      new ConsentImportError('duplicate_active')
    )

    const r = await promptMarketingOptin({
      restaurantId: 'r-1',
      phoneE164: '85291111111',
      source: 'inbound_first_wamid.A1',
    })

    expect(r).toEqual({ promptSent: false, reason: 'race_lost' })
    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled()
  })

  it('skips with template_not_utility when the template category is AUTHENTICATION (defensive)', async () => {
    vi.mocked(findTemplateById).mockResolvedValue({
      ...TEMPLATE,
      // Cast through unknown so this defensive case survives even if
      // future Meta categories are added to the union.
      category: 'AUTHENTICATION' as unknown as 'UTILITY',
    })

    const r = await promptMarketingOptin({
      restaurantId: 'r-1',
      phoneE164: '85291111111',
      source: 'inbound_first_wamid.A1',
    })

    expect(r).toEqual({ promptSent: false, reason: 'template_not_utility' })
    expect(insertConsentRecord).not.toHaveBeenCalled()
    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled()
  })
})

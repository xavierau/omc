/**
 * WONB-007 integration: drives `routeMessage` end-to-end (the same entry
 * the webhook route calls) to assert the inbound-first opt-in flow:
 *
 *   - First inbound from a paper-list-shell member with no strong-marketing
 *     consent triggers the confirmation template via the existing template
 *     send adapter.
 *   - Second inbound within 7d does NOT re-prompt (recent_pending gate).
 *   - YES upgrades the pending row; NO revokes it.
 *   - YES after window close still upgrades silently (no reply).
 *   - JOIN / image / STOP routes skip the prompt (system_keyword).
 *   - Receipt + opt-in both pending: receipt wins YES; opt-in stays pending.
 *   - KAPSO_DEFAULT_OPTIN_TEMPLATE_ID unset: prompt skipped, no consent insert.
 *
 * Strategy: stub each repository / use case the chain reaches so we can
 * assert call patterns and gate behaviour without a fake Supabase.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/restaurant-repository', () => ({
  getRestaurantPhoneNumberId: vi.fn(),
  getRestaurantName: vi.fn(),
  // REPLY-001: handleUnknown now reads the contact-redirect config. Default OFF
  // (null) preserves the existing 3-button / Join-invite fallback path here.
  getRestaurantRedirect: vi.fn(async () => ({
    redirectNumber: null,
    redirectLabel: 'Contact us',
  })),
  // REPLY-003: dispatch reads the reply config. Default = all functions ON,
  // no custom copy, preserving the existing fallback behavior here.
  getReplyConfig: vi.fn(async () => ({
    features: { points: true, rewards: true, redeem: true, card: true },
    text: {
      unknown: { en: null, zh: null },
      help: { en: null, zh: null },
      join: { en: null, zh: null },
    },
  })),
}))
vi.mock('@/infrastructure/supabase/repositories/restaurant-onboarding-repository', () => ({
  getRestaurantDefaultLanguage: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/member-repository', () => ({
  findMemberByPhone: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/consent-record-repository', () => ({
  insertConsentRecord: vi.fn(),
  revokeConsent: vi.fn(),
  upgradeToOptedIn: vi.fn(),
  findActiveConsent: vi.fn(),
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
vi.mock(
  '@/infrastructure/supabase/repositories/conversation-window-repository',
  () => ({
    upsertOpenWindow: vi.fn(async (w: unknown) => w),
    isWindowOpen: vi.fn(),
  })
)
vi.mock(
  '@/infrastructure/supabase/repositories/receipt-repository',
  () => ({
    findPendingReceipt: vi.fn(),
    updateReceipt: vi.fn(),
  })
)
vi.mock('@/application/process-receipt', () => ({
  confirmReceipt: vi.fn(async () => undefined),
  processReceipt: vi.fn(async () => undefined),
}))
vi.mock('@/infrastructure/supabase/client', () => ({
  createServerSupabaseClient: vi.fn(() => ({
    from: vi.fn(() => ({
      update: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
      insert: vi.fn(async () => ({ error: null })),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: async () => ({ data: null, error: null }),
          single: async () => ({ data: null, error: null }),
        })),
      })),
    })),
  })),
}))
vi.mock('@/application/emit-event', () => ({
  emitEvent: vi.fn(async () => 'evt-1'),
}))
vi.mock('@/application/send-template-message', () => ({
  sendWhatsAppTemplateMessage: vi.fn(async () => ({ success: true })),
}))
vi.mock('@/infrastructure/whatsapp/messaging', () => ({
  sendTextMessage: vi.fn(async () => ({ success: true })),
  sendInteractiveButtons: vi.fn(async () => ({ success: true })),
  sendImageMessage: vi.fn(async () => ({ success: true })),
}))

import { routeMessage } from '../handlers'
import { getRestaurantPhoneNumberId, getRestaurantName } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { getRestaurantDefaultLanguage } from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import { findMemberByPhone } from '@/infrastructure/supabase/repositories/member-repository'
import {
  insertConsentRecord,
  upgradeToOptedIn,
  findActiveConsent,
  revokeConsent,
} from '@/infrastructure/supabase/repositories/consent-record-repository'
import {
  findOptinTemplateOverride,
  findRecentPendingMarketingConsent,
} from '@/infrastructure/supabase/repositories/optin-template-repository'
import { findTemplateById } from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { isWindowOpen } from '@/infrastructure/supabase/repositories/conversation-window-repository'
import { findPendingReceipt } from '@/infrastructure/supabase/repositories/receipt-repository'
import { confirmReceipt } from '@/application/process-receipt'
import { emitEvent } from '@/application/emit-event'
import { sendWhatsAppTemplateMessage } from '@/application/send-template-message'
import { sendTextMessage } from '@/infrastructure/whatsapp/messaging'
import { ConsentRecord } from '@/domain/entities/consent-record'
import type { KapsoMessage } from '@/infrastructure/whatsapp/webhooks'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'

const RESTAURANT = 'rest-1'
const PHONE = '+85291111111'
const PHONE_E164 = '+85291111111'
const PHONE_NUMBER_ID = 'pn-1'

const TEMPLATE: WhatsAppTemplate = {
  id: 't-default',
  restaurantId: RESTAURANT,
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

function makeMessage(overrides: Partial<KapsoMessage> = {}): KapsoMessage {
  return {
    messageId: 'wamid.A1',
    from: PHONE,
    type: 'text',
    text: 'Hello',
    contactName: 'Tester',
    timestamp: String(Math.floor(Date.now() / 1000)),
    ...overrides,
  } as KapsoMessage
}

const ENV_KEY = 'KAPSO_DEFAULT_OPTIN_TEMPLATE_ID'
const ORIGINAL_ENV = process.env[ENV_KEY]

describe('routeMessage — WONB-007 inbound-first opt-in', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env[ENV_KEY] = 't-default'
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue(PHONE_NUMBER_ID)
    vi.mocked(getRestaurantName).mockResolvedValue('Demo Cafe')
    vi.mocked(getRestaurantDefaultLanguage).mockResolvedValue('en')
    vi.mocked(findMemberByPhone).mockResolvedValue({
      id: 'm-1',
      pointsBalance: 0,
      preferredLanguage: null,
    })
    vi.mocked(findActiveConsent).mockResolvedValue(null)
    vi.mocked(findRecentPendingMarketingConsent).mockResolvedValue(null)
    vi.mocked(findOptinTemplateOverride).mockResolvedValue(null)
    vi.mocked(findTemplateById).mockResolvedValue(TEMPLATE)
    vi.mocked(insertConsentRecord).mockResolvedValue(undefined)
    vi.mocked(revokeConsent).mockResolvedValue(0)
    vi.mocked(upgradeToOptedIn).mockResolvedValue(false)
    vi.mocked(isWindowOpen).mockResolvedValue(true)
    vi.mocked(findPendingReceipt).mockResolvedValue(null)
  })

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env[ENV_KEY]
    else process.env[ENV_KEY] = ORIGINAL_ENV
  })

  it('first inbound from a member with no marketing consent → sends opt-in template', async () => {
    await routeMessage(makeMessage({ text: 'Hi there' }), RESTAURANT)

    expect(insertConsentRecord).toHaveBeenCalledTimes(1)
    const inserted = vi.mocked(insertConsentRecord).mock.calls[0][0]
    expect(inserted.snapshot.status).toBe('pending')
    expect(inserted.snapshot.consentGrade).toBe('strong')
    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledTimes(1)
  })

  it('second inbound within 7d (recent_pending gate) does NOT re-prompt', async () => {
    const pending = ConsentRecord.markPending({
      id: 'c-pending',
      restaurantId: RESTAURANT,
      memberId: 'm-1',
      phoneE164: PHONE_E164,
      category: 'marketing',
      source: 'inbound_first_optin',
    })
    vi.mocked(findRecentPendingMarketingConsent).mockResolvedValue(pending)

    await routeMessage(makeMessage({ text: 'Hello again' }), RESTAURANT)

    expect(insertConsentRecord).not.toHaveBeenCalled()
    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled()
  })

  it('YES reply upgrades the pending row and emits consent_granted', async () => {
    vi.mocked(upgradeToOptedIn).mockResolvedValue(true)
    // existing strong consent, so the prompt path skips
    const opted = ConsentRecord.grant({
      id: 'c-strong',
      restaurantId: RESTAURANT,
      memberId: 'm-1',
      phoneE164: PHONE_E164,
      category: 'marketing',
      source: 'website_form',
    })
    vi.mocked(findActiveConsent).mockResolvedValue(opted)

    await routeMessage(makeMessage({ text: 'YES' }), RESTAURANT)

    expect(upgradeToOptedIn).toHaveBeenCalledWith({
      restaurantId: RESTAURANT,
      phoneE164: PHONE_E164,
      category: 'marketing',
    })
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'consent_granted',
        dataJson: { source: 'inbound_first_optin' },
      })
    )
    expect(sendTextMessage).toHaveBeenCalledWith(
      PHONE_NUMBER_ID,
      PHONE,
      expect.stringContaining('offers')
    )
  })

  it('NO reply revokes the pending row and emits consent_revoked', async () => {
    const pending = ConsentRecord.markPending({
      id: 'c-pending',
      restaurantId: RESTAURANT,
      memberId: 'm-1',
      phoneE164: PHONE_E164,
      category: 'marketing',
      source: 'inbound_first_optin',
    })
    vi.mocked(findRecentPendingMarketingConsent).mockResolvedValue(pending)
    vi.mocked(revokeConsent).mockResolvedValue(1)

    await routeMessage(makeMessage({ text: 'NO' }), RESTAURANT)

    expect(revokeConsent).toHaveBeenCalledWith({
      restaurantId: RESTAURANT,
      phoneE164: PHONE_E164,
      category: 'marketing',
    })
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'consent_revoked',
        dataJson: { source: 'inbound_first_optin_rejected' },
      })
    )
  })

  it('YES after the customer-service window has closed: still upgrades silently', async () => {
    vi.mocked(upgradeToOptedIn).mockResolvedValue(true)
    vi.mocked(isWindowOpen).mockResolvedValue(false)
    const opted = ConsentRecord.grant({
      id: 'c-strong',
      restaurantId: RESTAURANT,
      memberId: 'm-1',
      phoneE164: PHONE_E164,
      category: 'marketing',
      source: 'website_form',
    })
    vi.mocked(findActiveConsent).mockResolvedValue(opted)

    await routeMessage(makeMessage({ text: 'YES' }), RESTAURANT)

    expect(upgradeToOptedIn).toHaveBeenCalledTimes(1)
    expect(emitEvent).toHaveBeenCalledTimes(1)
    expect(sendTextMessage).not.toHaveBeenCalled()
  })

  it('JOIN inbound: opt-in prompt is skipped (system_keyword)', async () => {
    vi.mocked(findMemberByPhone).mockResolvedValueOnce(null)
    await routeMessage(makeMessage({ text: 'JOIN' }), RESTAURANT)

    expect(insertConsentRecord).not.toHaveBeenCalled()
    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled()
  })

  it('image inbound: opt-in prompt is skipped (system_keyword via non-text path)', async () => {
    await routeMessage(
      makeMessage({
        type: 'image',
        text: undefined,
        imageUrl: 'http://example.com/x.jpg',
      } as never),
      RESTAURANT
    )

    expect(insertConsentRecord).not.toHaveBeenCalled()
    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled()
  })

  it('STOP inbound: opt-in prompt is skipped (system_keyword)', async () => {
    await routeMessage(makeMessage({ text: 'STOP' }), RESTAURANT)

    expect(insertConsentRecord).not.toHaveBeenCalled()
    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled()
  })

  it('pending receipt + YES: receipt confirmation wins; opt-in confirmation does not run', async () => {
    vi.mocked(findPendingReceipt).mockResolvedValue({
      id: 'rcpt-1',
      pending_amount: 100,
    } as never)

    await routeMessage(makeMessage({ text: 'YES' }), RESTAURANT)

    expect(confirmReceipt).toHaveBeenCalledTimes(1)
    expect(upgradeToOptedIn).not.toHaveBeenCalled()
  })

  it('pending receipt + pending opt-in + NO: receipt rejection wins; opt-in rejection does NOT run', async () => {
    vi.mocked(findPendingReceipt).mockResolvedValue({
      id: 'rcpt-1',
      pending_amount: 100,
    } as never)
    const pending = ConsentRecord.markPending({
      id: 'c-pending',
      restaurantId: RESTAURANT,
      memberId: 'm-1',
      phoneE164: PHONE_E164,
      category: 'marketing',
      source: 'inbound_first_optin',
    })
    vi.mocked(findRecentPendingMarketingConsent).mockResolvedValue(pending)
    vi.mocked(revokeConsent).mockResolvedValue(1)

    await routeMessage(makeMessage({ text: 'NO' }), RESTAURANT)

    // revokeConsent must NOT have been called by the opt-in rejection
    // path. (Receipt-rejection path does not call revokeConsent.)
    expect(revokeConsent).not.toHaveBeenCalled()
  })

  it('KAPSO_DEFAULT_OPTIN_TEMPLATE_ID unset: prompt is skipped (no consent insert, no send)', async () => {
    delete process.env[ENV_KEY]

    await routeMessage(makeMessage({ text: 'Hi there' }), RESTAURANT)

    expect(insertConsentRecord).not.toHaveBeenCalled()
    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled()
  })

  it('member opted_out: prompt is skipped (no consent insert, no send) and skip is logged', async () => {
    const optedOut = ConsentRecord.grant({
      id: 'c-out',
      restaurantId: RESTAURANT,
      memberId: 'm-1',
      phoneE164: PHONE_E164,
      category: 'marketing',
      source: 'inbound_first_optin_rejected',
    }).revoke(new Date())
    vi.mocked(findActiveConsent).mockResolvedValue(optedOut)
    const logged: Array<[string, string, unknown]> = []
    const log = (lvl: 'info' | 'warn' | 'error', evt: string, d: unknown) => {
      logged.push([lvl, evt, d])
    }

    await routeMessage(makeMessage({ text: 'Hi there' }), RESTAURANT, log)

    expect(insertConsentRecord).not.toHaveBeenCalled()
    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled()
    const skip = logged.find((r) => r[1] === 'optin.skip')
    expect(skip?.[2]).toMatchObject({ reason: 'opted_out' })
  })
})

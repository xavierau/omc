import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Campaign } from '@/domain/entities/campaign'
import type { Member } from '@/domain/entities/member'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import type { SendContext } from '@/application/execute-campaign-batch'
import { DEFAULT_PACING_CONFIG } from '@/domain/value-objects/pacing-strategy'
import { okResult } from '@/test-utils/send-result'

vi.mock('@/infrastructure/whatsapp/messaging', () => ({
  sendTextMessage: vi.fn(),
  sendImageMessage: vi.fn(),
}))

vi.mock('@/application/send-template-message', () => ({
  sendWhatsAppTemplateMessage: vi.fn(),
}))

vi.mock('@/infrastructure/supabase/storage', () => ({
  uploadCouponQr: vi.fn(),
}))

vi.mock('@/infrastructure/supabase/repositories/coupon-repository', () => ({
  createCoupon: vi.fn(),
}))

vi.mock('@/infrastructure/supabase/repositories/whatsapp-message-repository', () => ({
  insertQueued: vi.fn(),
  attachKapsoMessageId: vi.fn(),
  markFailedNoBspId: vi.fn(),
}))

import {
  sendCampaignBody,
  sendClaimBody,
} from '@/application/execute-campaign-send'
import { sendTextMessage } from '@/infrastructure/whatsapp/messaging'
import { sendWhatsAppTemplateMessage } from '@/application/send-template-message'

function buildCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 'camp-1',
    restaurantId: 'r-1',
    name: 'Promo',
    type: 'promo',
    template: 'Hi {{name}}',
    templateEn: null,
    templateZhHk: null,
    imageUrlEn: null,
    imageUrlZhHk: null,
    couponConfig: {
      discountType: 'percentage',
      discountValue: 10,
      expiresInDays: 7,
    },
    schedule: null,
    scheduledAt: null,
    status: 'active',
    isChargeable: true,
    chargeableSentCount: 0,
    nonChargeableSentCount: 0,
    redeemedCount: 0,
    whatsappTemplateId: null,
    targetAudience: 'all',
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function buildMember(overrides: Partial<Member> = {}): Member {
  return {
    id: 'm-1',
    restaurantId: 'r-1',
    phone: '85290000001',
    name: 'Alice',
    pointsBalance: 0,
    status: 'active',
    joinedAt: '2024-01-01T00:00:00Z',
    lastVisitAt: null,
    preferredLanguage: null,
    pmmThrottledUntil: null,
    unreachableAt: null,
    ...overrides,
  }
}

function buildTemplate(overrides: Partial<WhatsAppTemplate> = {}): WhatsAppTemplate {
  return {
    id: 'tpl-1',
    restaurantId: 'r-1',
    metaTemplateId: 'meta-1',
    name: 'promo_template',
    language: 'en',
    category: 'MARKETING',
    status: 'approved',
    components: [],
    parameterFormat: 'NAMED',
    rejectionReason: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function buildCtx(overrides: Partial<SendContext> = {}): SendContext {
  return {
    campaign: buildCampaign(),
    phoneNumberId: 'phone-1',
    template: null,
    restaurantDefaultLanguage: 'en',
    // trackingEnabled: false → recordOutboundSend short-circuits to send()
    // with no DB writes, so we observe the returned SendResult directly.
    trackingEnabled: false,
    perUserMarketingCap: 1,
    pacingConfig: DEFAULT_PACING_CONFIG,
    ...overrides,
  }
}

describe('sendCampaignBody (eager) returns the SendResult', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the text-send result when there is no template', async () => {
    vi.mocked(sendTextMessage).mockResolvedValue(okResult('wamid.body'))
    const ctx = buildCtx({ template: null })

    const result = await sendCampaignBody(buildMember(), ctx, 'CODE1', 'desc')

    expect(result).toEqual(okResult('wamid.body'))
    expect(sendTextMessage).toHaveBeenCalledWith('phone-1', '85290000001', 'desc')
  })

  it('returns the template-send result and passes couponCode when there is a template', async () => {
    vi.mocked(sendWhatsAppTemplateMessage).mockResolvedValue(okResult('wamid.tpl'))
    const ctx = buildCtx({ template: buildTemplate() })

    const result = await sendCampaignBody(buildMember(), ctx, 'CODE1', 'desc')

    expect(result).toEqual(okResult('wamid.tpl'))
    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledWith(
      expect.objectContaining({ couponCode: 'CODE1' })
    )
  })
})

describe('sendClaimBody (claim mode)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends the template with the CLAIM_<campaignId> payload and omits the coupon code', async () => {
    vi.mocked(sendWhatsAppTemplateMessage).mockResolvedValue(okResult('wamid.claim'))
    const ctx = buildCtx({
      template: buildTemplate(),
      campaign: buildCampaign({ id: 'camp-XyZ' }),
    })

    const result = await sendClaimBody(buildMember({ name: 'Alice' }), ctx)

    expect(result).toEqual(okResult('wamid.claim'))
    const arg = vi.mocked(sendWhatsAppTemplateMessage).mock.calls[0][0]
    expect(arg.claimPayload).toBe('CLAIM_camp-XyZ')
    expect(arg.couponCode).toBeUndefined()
    // Body params carry customer_name + discount only — never a code.
    expect(arg.paramValues).toEqual({ customer_name: 'Alice', discount: '10%' })
  })

  it('does not send a text message in claim mode', async () => {
    vi.mocked(sendWhatsAppTemplateMessage).mockResolvedValue(okResult('wamid.claim'))
    const ctx = buildCtx({ template: buildTemplate() })

    await sendClaimBody(buildMember(), ctx)

    expect(sendTextMessage).not.toHaveBeenCalled()
  })
})

// BOOK-001 W3 (AC-16): a Book now campaign mints one `campaign` booking token
// per recipient at send time and hands it to the template sender; any other
// campaign mints nothing and sends exactly as before.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SendContext } from '@/application/execute-campaign-batch'
import { DEFAULT_PACING_CONFIG } from '@/domain/value-objects/pacing-strategy'
import { DEFAULT_BOOKING_CONFIG } from '@/domain/value-objects/booking-config'
import { okResult } from '@/test-utils/send-result'
import { buildCampaign, buildMember, buildWhatsAppTemplate } from '@/test-utils/builders'

vi.mock('@/infrastructure/whatsapp/messaging', () => ({ sendTextMessage: vi.fn(), sendImageMessage: vi.fn() }))
vi.mock('@/application/send-template-message', () => ({ sendWhatsAppTemplateMessage: vi.fn() }))
vi.mock('@/infrastructure/supabase/storage', () => ({ uploadCouponQr: vi.fn() }))
vi.mock('@/infrastructure/supabase/repositories/booking-token-repository', () => ({ mintBookingToken: vi.fn() }))

import { sendCampaignBody, sendClaimBody } from '@/application/execute-campaign-send'
import { sendWhatsAppTemplateMessage } from '@/application/send-template-message'
import { mintBookingToken } from '@/infrastructure/supabase/repositories/booking-token-repository'
import { bookNowSendContext } from '@/application/campaign-book-now-context'

const template = buildWhatsAppTemplate({ id: 'tpl-b' })
const claimTemplate = buildWhatsAppTemplate({
  id: 'tpl-claim',
  components: [{ type: 'BODY', text: 'Hi' }, { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Claim' }] }],
})

function ctx(overrides: Partial<SendContext> = {}): SendContext {
  return {
    campaign: buildCampaign({ id: 'camp-9', restaurantId: 'rest-a', bookNowEnabled: true }),
    phoneNumberId: 'pn-1',
    template,
    restaurantDefaultLanguage: null,
    trackingEnabled: false,
    perUserMarketingCap: 2,
    pacingConfig: DEFAULT_PACING_CONFIG,
    bookNow: { ttlHours: 168 },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(sendWhatsAppTemplateMessage).mockResolvedValue(okResult())
  let n = 0
  vi.mocked(mintBookingToken).mockImplementation(async () => `tok_${++n}`)
})

describe('Book now campaign send (AC-16)', () => {
  it('mints one campaign token per recipient and passes it as the booking token', async () => {
    const alice = buildMember({ id: 'm-1', phone: '+85291111111' })
    const bob = buildMember({ id: 'm-2', phone: '+85292222222' })
    await sendCampaignBody(alice, ctx(), '', 'desc')
    await sendCampaignBody(bob, ctx(), '', 'desc')

    expect(mintBookingToken).toHaveBeenCalledTimes(2)
    expect(mintBookingToken).toHaveBeenNthCalledWith(1, {
      restaurantId: 'rest-a', phone: '+85291111111', source: 'campaign', campaignId: 'camp-9', ttlHours: 168,
    })
    expect(vi.mocked(mintBookingToken).mock.calls[1][0].phone).toBe('+85292222222')
    const sent = vi.mocked(sendWhatsAppTemplateMessage).mock.calls.map((c) => c[0].bookingToken)
    expect(sent).toEqual(['tok_1', 'tok_2'])
  })

  it('passes a null lifetime through (no expiry)', async () => {
    await sendCampaignBody(buildMember(), ctx({ bookNow: { ttlHours: null } }), '', 'd')
    expect(vi.mocked(mintBookingToken).mock.calls[0][0].ttlHours).toBeNull()
  })

  it('claim-mode Book now campaigns carry the token too', async () => {
    await sendClaimBody(buildMember(), ctx({ template: claimTemplate }))
    expect(vi.mocked(sendWhatsAppTemplateMessage).mock.calls[0][0]).toMatchObject({ bookingToken: 'tok_1', claimPayload: 'CLAIM_camp-9' })
  })

  it('a failed mint fails that send instead of shipping a dead button', async () => {
    vi.mocked(mintBookingToken).mockResolvedValue(null)
    const result = await sendCampaignBody(buildMember(), ctx(), '', 'd')
    expect(result.ok).toBe(false)
    expect(result.error?.title).toBe('book_now_link_unavailable')
    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled()
  })

  it('a non-Book-now campaign mints nothing and sends exactly as before', async () => {
    await sendCampaignBody(buildMember(), ctx({ bookNow: null, campaign: buildCampaign() }), 'CODE1', 'd')
    expect(mintBookingToken).not.toHaveBeenCalled()
    const args = vi.mocked(sendWhatsAppTemplateMessage).mock.calls[0][0]
    expect(args).not.toHaveProperty('bookingToken')
    expect(args.couponCode).toBe('CODE1')
  })
})

describe('bookNowSendContext', () => {
  it('reads campaignLinkTtlHours for a Book now campaign, regardless of the current mode', async () => {
    const getConfig = vi.fn().mockResolvedValue({ ...DEFAULT_BOOKING_CONFIG, mode: 'external', campaignLinkTtlHours: 72 })
    expect(await bookNowSendContext(buildCampaign({ bookNowEnabled: true, restaurantId: 'rest-a' }), getConfig)).toEqual({ ttlHours: 72 })
    expect(getConfig).toHaveBeenCalledWith('rest-a')
  })

  it('keeps null (no expiry)', async () => {
    const getConfig = vi.fn().mockResolvedValue({ ...DEFAULT_BOOKING_CONFIG, campaignLinkTtlHours: null })
    expect(await bookNowSendContext(buildCampaign({ bookNowEnabled: true }), getConfig)).toEqual({ ttlHours: null })
  })

  it('is null and reads nothing for a campaign without Book now', async () => {
    const getConfig = vi.fn()
    expect(await bookNowSendContext(buildCampaign(), getConfig)).toBeNull()
    expect(getConfig).not.toHaveBeenCalled()
  })
})

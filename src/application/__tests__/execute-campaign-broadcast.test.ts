import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Campaign } from '@/domain/entities/campaign'
import type { Member } from '@/domain/entities/member'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import type { Coupon } from '@/domain/entities/coupon'
import type { SendContext } from '@/application/execute-campaign-batch'
import { DEFAULT_PACING_CONFIG } from '@/domain/value-objects/pacing-strategy'
import { okResult, failResult } from '@/test-utils/send-result'

vi.mock('@/application/execute-campaign-send', () => ({
  sendCampaignBody: vi.fn(),
  sendClaimBody: vi.fn(),
  sendCouponQr: vi.fn(),
}))

vi.mock('@/application/execute-campaign-coupon', () => ({
  createCampaignBroadcastCoupon: vi.fn(),
  formatDiscount: vi.fn(() => ''),
}))

vi.mock('@/infrastructure/supabase/repositories/campaign-repository', () => ({
  incrementCampaignSent: vi.fn(),
}))

vi.mock('@/application/emit-event', () => ({
  emitEvent: vi.fn(),
}))

vi.mock('@/domain/value-objects/coupon-code', () => ({
  generateCouponCode: vi.fn(),
}))

vi.mock('@/domain/services/template-renderer', () => ({
  renderTemplate: vi.fn(),
}))

vi.mock('@/domain/services/resolve-preferred-language', () => ({
  resolvePreferredLanguage: vi.fn(() => 'en'),
}))

vi.mock('@/application/resolve-campaign-template', () => ({
  resolveCampaignTemplate: vi.fn(() => 'inline {{name}}'),
}))

import { sendToMember } from '@/application/execute-campaign-broadcast'
import {
  sendCampaignBody,
  sendClaimBody,
  sendCouponQr,
} from '@/application/execute-campaign-send'
import { createCampaignBroadcastCoupon } from '@/application/execute-campaign-coupon'
import { incrementCampaignSent } from '@/infrastructure/supabase/repositories/campaign-repository'
import { emitEvent } from '@/application/emit-event'
import { generateCouponCode } from '@/domain/value-objects/coupon-code'
import { renderTemplate } from '@/domain/services/template-renderer'

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
    failureReason: null,
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

function buildTemplate(
  buttons: WhatsAppTemplate['components'][number]['buttons']
): WhatsAppTemplate {
  return {
    id: 'tpl-1',
    restaurantId: 'r-1',
    metaTemplateId: 'meta-1',
    name: 'promo_template',
    language: 'en',
    category: 'MARKETING',
    status: 'approved',
    components: [
      { type: 'BODY', text: 'Hi {{customer_name}}' },
      { type: 'BUTTONS', buttons },
    ],
    parameterFormat: 'NAMED',
    rejectionReason: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  }
}

function buildCoupon(overrides: Partial<Coupon> = {}): Coupon {
  return {
    id: 'coupon-1',
    restaurantId: 'r-1',
    type: 'promo',
    code: 'CODE01',
    status: 'active',
    memberId: 'm-1',
    expiresAt: null,
    redeemedAt: null,
    discountType: 'percentage',
    discountValue: 10,
    maxUses: 1,
    currentUses: 0,
    isActive: true,
    isChargeable: true,
    title: 'Promo',
    description: 'desc',
    campaignId: 'camp-1',
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

const claimTemplate = buildTemplate([{ type: 'QUICK_REPLY', text: 'Claim' }])
const urlTemplate = buildTemplate([
  { type: 'URL', text: 'Redeem', url: 'https://x.example/{{1}}' },
])

function buildCtx(overrides: Partial<SendContext> = {}): SendContext {
  return {
    campaign: buildCampaign(),
    phoneNumberId: 'phone-1',
    template: null,
    restaurantDefaultLanguage: 'en',
    trackingEnabled: false,
    perUserMarketingCap: 1,
    pacingConfig: DEFAULT_PACING_CONFIG,
    ...overrides,
  }
}

describe('sendToMember — claim mode (template has a QUICK_REPLY button)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(generateCouponCode).mockReturnValue('CODE01')
    vi.mocked(renderTemplate).mockReturnValue('desc')
  })

  it('sends exactly one claim template, then increments + emits on success', async () => {
    vi.mocked(sendClaimBody).mockResolvedValue(okResult('wamid.claim'))
    const ctx = buildCtx({ template: claimTemplate })

    await sendToMember(buildMember(), ctx)

    expect(sendClaimBody).toHaveBeenCalledTimes(1)
    expect(createCampaignBroadcastCoupon).not.toHaveBeenCalled()
    expect(sendCouponQr).not.toHaveBeenCalled()
    expect(incrementCampaignSent).toHaveBeenCalledWith('camp-1', true)
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ dataJson: { campaignId: 'camp-1' } })
    )
  })

  it('throws and does NOT increment/emit/mint when the claim send fails', async () => {
    vi.mocked(sendClaimBody).mockResolvedValue(failResult('kapso_send_error'))
    const ctx = buildCtx({ template: claimTemplate })

    await expect(sendToMember(buildMember(), ctx)).rejects.toThrow()

    expect(incrementCampaignSent).not.toHaveBeenCalled()
    expect(emitEvent).not.toHaveBeenCalled()
    expect(createCampaignBroadcastCoupon).not.toHaveBeenCalled()
    expect(sendCouponQr).not.toHaveBeenCalled()
  })
})

describe('sendToMember — eager mode (no QUICK_REPLY button)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(generateCouponCode).mockReturnValue('CODE01')
    vi.mocked(renderTemplate).mockReturnValue('desc')
    // clearAllMocks() resets calls but NOT implementations — set a successful
    // mint default so a failure-path test's mockRejectedValue can't leak into
    // the next test.
    vi.mocked(createCampaignBroadcastCoupon).mockResolvedValue(buildCoupon())
  })

  it('sends body, then mints coupon + QR + increments + emits on success', async () => {
    vi.mocked(sendCampaignBody).mockResolvedValue(okResult('wamid.body'))
    const ctx = buildCtx({ template: null })

    await sendToMember(buildMember(), ctx)

    expect(sendCampaignBody).toHaveBeenCalledTimes(1)
    expect(sendClaimBody).not.toHaveBeenCalled()
    expect(createCampaignBroadcastCoupon).toHaveBeenCalledTimes(1)
    expect(sendCouponQr).toHaveBeenCalledTimes(1)
    expect(incrementCampaignSent).toHaveBeenCalledWith('camp-1', true)
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        dataJson: { campaignId: 'camp-1', couponCode: 'CODE01' },
      })
    )
  })

  it('sends the body BEFORE minting the coupon (no orphan coupons)', async () => {
    const order: string[] = []
    vi.mocked(sendCampaignBody).mockImplementation(async () => {
      order.push('body')
      return okResult('wamid.body')
    })
    vi.mocked(createCampaignBroadcastCoupon).mockImplementation(async () => {
      order.push('mint')
      return buildCoupon()
    })
    const ctx = buildCtx({ template: null })

    await sendToMember(buildMember(), ctx)

    expect(order).toEqual(['body', 'mint'])
  })

  it('throws and does NOT mint/QR/increment/emit when the body send fails', async () => {
    vi.mocked(sendCampaignBody).mockResolvedValue(failResult('kapso_send_error'))
    const ctx = buildCtx({ template: null })

    await expect(sendToMember(buildMember(), ctx)).rejects.toThrow()

    expect(createCampaignBroadcastCoupon).not.toHaveBeenCalled()
    expect(sendCouponQr).not.toHaveBeenCalled()
    expect(incrementCampaignSent).not.toHaveBeenCalled()
    expect(emitEvent).not.toHaveBeenCalled()
  })

  it('tolerates a duplicate-coupon (23505) on retry — no throw, no QR/increment/emit', async () => {
    // A re-executed campaign re-mints an already-minted member; the migration-053
    // unique index raises 23505. The member already has their coupon + QR, so we
    // skip gracefully instead of throwing (which would tally them `failed`).
    vi.mocked(sendCampaignBody).mockResolvedValue(okResult('wamid.body'))
    vi.mocked(createCampaignBroadcastCoupon).mockRejectedValue(
      new Error(
        'createCoupon: duplicate key value violates unique constraint "uniq_coupon_campaign_member"'
      )
    )
    const ctx = buildCtx({ template: null })

    await expect(sendToMember(buildMember(), ctx)).resolves.toBe('sent')

    expect(sendCouponQr).not.toHaveBeenCalled()
    expect(incrementCampaignSent).not.toHaveBeenCalled()
    expect(emitEvent).not.toHaveBeenCalled()
  })

  it('rethrows a non-unique mint failure (does not swallow real errors)', async () => {
    vi.mocked(sendCampaignBody).mockResolvedValue(okResult('wamid.body'))
    vi.mocked(createCampaignBroadcastCoupon).mockRejectedValue(
      new Error('createCoupon: connection reset')
    )
    const ctx = buildCtx({ template: null })

    await expect(sendToMember(buildMember(), ctx)).rejects.toThrow('connection reset')
    expect(incrementCampaignSent).not.toHaveBeenCalled()
  })

  it('treats a template WITHOUT a QUICK_REPLY button as eager mode', async () => {
    vi.mocked(sendCampaignBody).mockResolvedValue(okResult('wamid.body'))
    const ctx = buildCtx({ template: urlTemplate })

    await sendToMember(buildMember(), ctx)

    expect(sendClaimBody).not.toHaveBeenCalled()
    expect(sendCampaignBody).toHaveBeenCalledTimes(1)
    expect(createCampaignBroadcastCoupon).toHaveBeenCalledTimes(1)
  })
})

// #131 §4 / CAMP-002: a campaign re-run after a Meta-side fix must reach the
// members whose first send was rejected WITH the code they already hold —
// the old path re-sent a body carrying a fresh code, hit migration 053 on
// the mint, and then skipped the QR, the counter and the event.
describe('sendToMember — eager mode re-run with an existing coupon (#131)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(generateCouponCode).mockReturnValue('NEWCODE')
    vi.mocked(renderTemplate).mockReturnValue('desc')
    vi.mocked(sendCampaignBody).mockResolvedValue(okResult('wamid.body'))
  })

  function prefetchWith(coupon: Coupon) {
    return {
      countedMemberIds: new Set<string>(),
      existingCoupons: new Map([[coupon.memberId as string, coupon]]),
    }
  }

  it('reuses the existing active coupon: body carries ITS code, no mint, then QR + count + event', async () => {
    const existing = buildCoupon({ code: 'OLDCODE', memberId: 'm-1' })
    const ctx = buildCtx({ template: null })

    const outcome = await sendToMember(buildMember(), ctx, prefetchWith(existing))

    expect(outcome).toBe('sent')
    expect(generateCouponCode).not.toHaveBeenCalled()
    expect(sendCampaignBody).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'm-1' }),
      ctx,
      'OLDCODE',
      expect.any(String)
    )
    expect(createCampaignBroadcastCoupon).not.toHaveBeenCalled()
    expect(sendCouponQr).toHaveBeenCalledWith(expect.objectContaining({ id: 'm-1' }), ctx, 'OLDCODE')
    expect(incrementCampaignSent).toHaveBeenCalledWith('camp-1', true)
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ dataJson: { campaignId: 'camp-1', couponCode: 'OLDCODE' } })
    )
  })

  it('skips the member entirely when the existing coupon is redeemed', async () => {
    const redeemed = buildCoupon({ status: 'redeemed', redeemedAt: '2026-08-01T00:00:00Z', currentUses: 1 })
    const ctx = buildCtx({ template: null })

    const outcome = await sendToMember(buildMember(), ctx, prefetchWith(redeemed))

    expect(outcome).toBe('skipped_already_sent')
    expect(sendCampaignBody).not.toHaveBeenCalled()
    expect(sendCouponQr).not.toHaveBeenCalled()
    expect(incrementCampaignSent).not.toHaveBeenCalled()
    expect(emitEvent).not.toHaveBeenCalled()
  })

  it('skips the member when the existing coupon has expired', async () => {
    const expired = buildCoupon({ expiresAt: '2020-01-01T00:00:00Z' })

    const outcome = await sendToMember(buildMember(), buildCtx({ template: null }), prefetchWith(expired))

    expect(outcome).toBe('skipped_already_sent')
    expect(sendCampaignBody).not.toHaveBeenCalled()
  })

  it('mints a fresh coupon when the member holds none (first run unchanged)', async () => {
    const ctx = buildCtx({ template: null })
    vi.mocked(createCampaignBroadcastCoupon).mockResolvedValue(buildCoupon({ code: 'NEWCODE' }))

    const outcome = await sendToMember(buildMember(), ctx, {
      countedMemberIds: new Set(),
      existingCoupons: new Map(),
    })

    expect(outcome).toBe('sent')
    expect(sendCampaignBody).toHaveBeenCalledWith(expect.anything(), ctx, 'NEWCODE', expect.any(String))
    expect(createCampaignBroadcastCoupon).toHaveBeenCalledTimes(1)
  })

  it('does not send a body with a reused code when the send itself fails', async () => {
    vi.mocked(sendCampaignBody).mockResolvedValue(failResult('kapso_send_error'))
    const existing = buildCoupon({ code: 'OLDCODE' })

    await expect(
      sendToMember(buildMember(), buildCtx({ template: null }), prefetchWith(existing))
    ).rejects.toThrow()

    expect(sendCouponQr).not.toHaveBeenCalled()
    expect(incrementCampaignSent).not.toHaveBeenCalled()
  })

  it('claim mode ignores existing coupons (nothing is minted at broadcast)', async () => {
    vi.mocked(sendClaimBody).mockResolvedValue(okResult('wamid.claim'))
    const existing = buildCoupon({ code: 'OLDCODE' })

    const outcome = await sendToMember(buildMember(), buildCtx({ template: claimTemplate }), prefetchWith(existing))

    expect(outcome).toBe('sent')
    expect(sendClaimBody).toHaveBeenCalledTimes(1)
    expect(sendCouponQr).not.toHaveBeenCalled()
  })
})

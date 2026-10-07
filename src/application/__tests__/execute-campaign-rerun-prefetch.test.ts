import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildCampaign, buildMember, buildWhatsAppTemplate } from '@/test-utils/builders'
import { DEFAULT_PACING_CONFIG } from '@/domain/value-objects/pacing-strategy'
import type { SendContext } from '@/application/execute-campaign-batch'

vi.mock('@/infrastructure/supabase/repositories/whatsapp-message-ledger-queries', () => ({
  findMemberIdsWithCountedSend: vi.fn(),
}))

vi.mock('@/infrastructure/supabase/repositories/coupon-campaign-queries', () => ({
  findCouponsByMembersAndCampaign: vi.fn(),
}))

import { loadRerunPrefetch } from '@/application/execute-campaign-rerun-prefetch'
import { findMemberIdsWithCountedSend } from '@/infrastructure/supabase/repositories/whatsapp-message-ledger-queries'
import { findCouponsByMembersAndCampaign } from '@/infrastructure/supabase/repositories/coupon-campaign-queries'

const claimTemplate = buildWhatsAppTemplate({
  components: [
    { type: 'BODY', text: 'Hi {{customer_name}}' },
    { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Claim' }] },
  ],
})

function buildCtx(overrides: Partial<SendContext> = {}): SendContext {
  return {
    campaign: buildCampaign({
      couponConfig: { discountType: 'percentage', discountValue: 10, expiresInDays: 7 },
    }),
    phoneNumberId: 'phone-1',
    template: null,
    restaurantDefaultLanguage: 'en',
    trackingEnabled: false,
    perUserMarketingCap: 1,
    pacingConfig: DEFAULT_PACING_CONFIG,
    ...overrides,
  }
}

describe('loadRerunPrefetch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(findMemberIdsWithCountedSend).mockResolvedValue(new Set(['m-counted']))
    vi.mocked(findCouponsByMembersAndCampaign).mockResolvedValue(new Map())
  })

  it('skips the counted-send query when tracking is disabled', async () => {
    const ctx = buildCtx({ trackingEnabled: false })

    const result = await loadRerunPrefetch([buildMember({ id: 'm-1' })], ctx)

    expect(findMemberIdsWithCountedSend).not.toHaveBeenCalled()
    expect(result.countedMemberIds).toEqual(new Set())
  })

  it('runs the counted-send query when tracking is enabled', async () => {
    const ctx = buildCtx({ trackingEnabled: true })

    const result = await loadRerunPrefetch([buildMember({ id: 'm-1' })], ctx)

    expect(findMemberIdsWithCountedSend).toHaveBeenCalledWith({
      campaignId: ctx.campaign.id,
      restaurantId: ctx.campaign.restaurantId,
      memberIds: ['m-1'],
    })
    expect(result.countedMemberIds).toEqual(new Set(['m-counted']))
  })

  it('skips the coupon query for a claim-mode template', async () => {
    const ctx = buildCtx({ template: claimTemplate })

    const result = await loadRerunPrefetch([buildMember({ id: 'm-1' })], ctx)

    expect(findCouponsByMembersAndCampaign).not.toHaveBeenCalled()
    expect(result.existingCoupons).toEqual(new Map())
  })

  // R5 (round 2 / #134): marketing-only mode (couponConfig null) never reads
  // existingCoupons — sendToMember's marketing-only branch never looks at
  // the coupon prefetch, so the query is dead weight.
  it('skips the coupon query when couponConfig is null (marketing-only)', async () => {
    const ctx = buildCtx({
      campaign: buildCampaign({ couponConfig: null }),
      template: null,
    })

    const result = await loadRerunPrefetch([buildMember({ id: 'm-1' })], ctx)

    expect(findCouponsByMembersAndCampaign).not.toHaveBeenCalled()
    expect(result.existingCoupons).toEqual(new Map())
  })

  it('runs the coupon query for a non-claim template with couponConfig set', async () => {
    const coupons = new Map([['m-1', { code: 'X' }]]) as never
    vi.mocked(findCouponsByMembersAndCampaign).mockResolvedValue(coupons)
    const ctx = buildCtx()

    const result = await loadRerunPrefetch([buildMember({ id: 'm-1' })], ctx)

    expect(findCouponsByMembersAndCampaign).toHaveBeenCalledWith({
      restaurantId: ctx.campaign.restaurantId,
      campaignId: ctx.campaign.id,
      memberIds: ['m-1'],
    })
    expect(result.existingCoupons).toBe(coupons)
  })
})

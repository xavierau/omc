import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Campaign } from '@/domain/entities/campaign'
import type { Member } from '@/domain/entities/member'
import type { Coupon } from '@/domain/entities/coupon'
import { Language } from '@/domain/value-objects/language'

vi.mock('@/infrastructure/supabase/repositories/member-repository', () => ({
  findMemberByPhone: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/campaign-repository', () => ({
  getCampaignById: vi.fn(),
  getCampaignMemberIds: vi.fn(),
}))
vi.mock('@/infrastructure/whatsapp/messaging', () => ({
  sendTextMessage: vi.fn(),
  sendImageMessage: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/storage', () => ({
  uploadCouponQr: vi.fn(),
}))
vi.mock('@/application/claim-campaign-coupon', () => ({
  claimCampaignCoupon: vi.fn(),
}))
vi.mock('@/application/record-outbound-send', () => ({
  recordOutboundSend: vi.fn(),
}))
vi.mock('../resolve-language', () => ({
  resolveLanguageForMember: vi.fn(),
}))

import { handleClaim, isCampaignClaimable } from '../claim-handler'
import { findMemberByPhone } from '@/infrastructure/supabase/repositories/member-repository'
import {
  getCampaignById,
  getCampaignMemberIds,
} from '@/infrastructure/supabase/repositories/campaign-repository'
import { sendTextMessage, sendImageMessage } from '@/infrastructure/whatsapp/messaging'
import { uploadCouponQr } from '@/infrastructure/supabase/storage'
import { claimCampaignCoupon } from '@/application/claim-campaign-coupon'
import { recordOutboundSend } from '@/application/record-outbound-send'
import { resolveLanguageForMember } from '../resolve-language'

const OK = { ok: true, kapsoMessageId: 'wamid.x', raw: null }

function buildMember(o: Partial<Member> = {}): Member {
  return {
    id: 'm-1', restaurantId: 'r-1', phone: '85261234567', name: 'Ada',
    pointsBalance: 0, status: 'active', joinedAt: '2024-01-01T00:00:00Z',
    lastVisitAt: null, preferredLanguage: 'en', pmmThrottledUntil: null,
    unreachableAt: null, ...o,
  }
}

function buildCampaign(o: Partial<Campaign> = {}): Campaign {
  return {
    id: 'camp-1', restaurantId: 'r-1', name: 'Promo', type: 'promo',
    template: '', templateEn: null, templateZhHk: null, imageUrlEn: null,
    imageUrlZhHk: null, couponConfig: null, schedule: null, scheduledAt: null,
    status: 'active', failureReason: null, isChargeable: true, chargeableSentCount: 0,
    nonChargeableSentCount: 0, redeemedCount: 0, whatsappTemplateId: null,
    targetAudience: 'all', createdAt: '2024-01-01T00:00:00Z', ...o,
  }
}

function buildCoupon(o: Partial<Coupon> = {}): Coupon {
  return {
    id: 'c-1', restaurantId: 'r-1', type: 'promo', code: 'CLAIMED1',
    status: 'active', memberId: 'm-1', expiresAt: null, redeemedAt: null,
    discountType: null, discountValue: null, maxUses: 1, currentUses: 0,
    isActive: true, isChargeable: true, title: null, description: null,
    campaignId: 'camp-1', createdAt: '2024-01-01T00:00:00Z', ...o,
  }
}

function params(o: Partial<Parameters<typeof handleClaim>[0]> = {}) {
  return {
    phoneNumberId: 'pn-1', phone: '85261234567', campaignId: 'camp-1',
    restaurantId: 'r-1', log: vi.fn(), ...o,
  }
}

describe('isCampaignClaimable', () => {
  it.each(['active', 'sending', 'completed'] as const)(
    '%s is claimable (window open while live or done)',
    (status) => {
      expect(isCampaignClaimable(status)).toBe(true)
    }
  )
  it.each(['draft', 'paused'] as const)('%s is NOT claimable', (status) => {
    expect(isCampaignClaimable(status)).toBe(false)
  })
})

describe('handleClaim', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(resolveLanguageForMember).mockResolvedValue(Language.EN)
    vi.mocked(sendTextMessage).mockResolvedValue(OK)
    vi.mocked(sendImageMessage).mockResolvedValue(OK)
    vi.mocked(uploadCouponQr).mockResolvedValue('https://cdn/qr.png')
    vi.mocked(recordOutboundSend).mockImplementation((args) => args.send())
    vi.mocked(getCampaignMemberIds).mockResolvedValue([])
  })

  it('non-member → nonMember reply, no mint', async () => {
    vi.mocked(findMemberByPhone).mockResolvedValue(null)

    await handleClaim(params())

    expect(sendTextMessage).toHaveBeenCalledWith(
      'pn-1', '85261234567', expect.stringContaining('member')
    )
    expect(claimCampaignCoupon).not.toHaveBeenCalled()
    expect(sendImageMessage).not.toHaveBeenCalled()
  })

  it('campaign not found → campaignUnavailable reply + warn, no mint', async () => {
    vi.mocked(findMemberByPhone).mockResolvedValue(buildMember())
    vi.mocked(getCampaignById).mockResolvedValue(null)
    const p = params()

    await handleClaim(p)

    expect(sendTextMessage).toHaveBeenCalledWith(
      'pn-1', '85261234567', expect.stringContaining("isn't available")
    )
    expect(p.log).toHaveBeenCalledWith(
      'warn', 'claim.tenant_mismatch', expect.objectContaining({ campaignId: 'camp-1' })
    )
    expect(claimCampaignCoupon).not.toHaveBeenCalled()
  })

  it('cross-tenant campaign → campaignUnavailable + warn, no mint (AC#6)', async () => {
    vi.mocked(findMemberByPhone).mockResolvedValue(buildMember())
    vi.mocked(getCampaignById).mockResolvedValue(
      buildCampaign({ restaurantId: 'r-OTHER' })
    )
    const p = params()

    await handleClaim(p)

    expect(p.log).toHaveBeenCalledWith(
      'warn', 'claim.tenant_mismatch', expect.any(Object)
    )
    expect(claimCampaignCoupon).not.toHaveBeenCalled()
    expect(sendImageMessage).not.toHaveBeenCalled()
  })

  it('paused campaign → refusal, no mint', async () => {
    vi.mocked(findMemberByPhone).mockResolvedValue(buildMember())
    vi.mocked(getCampaignById).mockResolvedValue(buildCampaign({ status: 'paused' }))

    await handleClaim(params())

    expect(sendTextMessage).toHaveBeenCalledWith(
      'pn-1', '85261234567', expect.stringContaining("isn't available")
    )
    expect(claimCampaignCoupon).not.toHaveBeenCalled()
  })

  it('happy path → mints and sends the QR image with the code caption', async () => {
    vi.mocked(findMemberByPhone).mockResolvedValue(buildMember())
    vi.mocked(getCampaignById).mockResolvedValue(buildCampaign())
    vi.mocked(claimCampaignCoupon).mockResolvedValue({
      coupon: buildCoupon({ code: 'HAPPY1' }), alreadyClaimed: false,
    })

    await handleClaim(params())

    expect(claimCampaignCoupon).toHaveBeenCalledOnce()
    expect(uploadCouponQr).toHaveBeenCalledWith('HAPPY1')
    expect(sendImageMessage).toHaveBeenCalledWith(
      'pn-1', '85261234567', 'https://cdn/qr.png', expect.stringContaining('HAPPY1')
    )
    expect(recordOutboundSend).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'service', messageType: 'image' })
    )
  })

  it('double-tap (alreadyClaimed) → same coupon, QR resent', async () => {
    vi.mocked(findMemberByPhone).mockResolvedValue(buildMember())
    vi.mocked(getCampaignById).mockResolvedValue(buildCampaign())
    vi.mocked(claimCampaignCoupon).mockResolvedValue({
      coupon: buildCoupon({ code: 'DUP1' }), alreadyClaimed: true,
    })

    await handleClaim(params())

    expect(uploadCouponQr).toHaveBeenCalledWith('DUP1')
    expect(sendImageMessage).toHaveBeenCalledWith(
      'pn-1', '85261234567', 'https://cdn/qr.png', expect.stringContaining('DUP1')
    )
  })

  it('selected-audience campaign, member NOT targeted → refusal + warn, no mint (F1)', async () => {
    vi.mocked(findMemberByPhone).mockResolvedValue(buildMember({ id: 'm-1' }))
    vi.mocked(getCampaignById).mockResolvedValue(
      buildCampaign({ targetAudience: 'selected' })
    )
    vi.mocked(getCampaignMemberIds).mockResolvedValue(['m-OTHER'])
    const p = params()

    await handleClaim(p)

    expect(p.log).toHaveBeenCalledWith(
      'warn', 'claim.not_targeted', expect.objectContaining({ campaignId: 'camp-1' })
    )
    expect(claimCampaignCoupon).not.toHaveBeenCalled()
    expect(sendImageMessage).not.toHaveBeenCalled()
  })

  it('selected-audience campaign, member IS targeted → mints', async () => {
    vi.mocked(findMemberByPhone).mockResolvedValue(buildMember({ id: 'm-1' }))
    vi.mocked(getCampaignById).mockResolvedValue(
      buildCampaign({ targetAudience: 'selected' })
    )
    vi.mocked(getCampaignMemberIds).mockResolvedValue(['m-OTHER', 'm-1'])
    vi.mocked(claimCampaignCoupon).mockResolvedValue({
      coupon: buildCoupon({ code: 'SEL1' }), alreadyClaimed: false,
    })

    await handleClaim(params())

    expect(claimCampaignCoupon).toHaveBeenCalledOnce()
    expect(sendImageMessage).toHaveBeenCalled()
  })

  it('all-audience campaign does NOT query the target set (every member eligible)', async () => {
    vi.mocked(findMemberByPhone).mockResolvedValue(buildMember())
    vi.mocked(getCampaignById).mockResolvedValue(buildCampaign({ targetAudience: 'all' }))
    vi.mocked(claimCampaignCoupon).mockResolvedValue({
      coupon: buildCoupon(), alreadyClaimed: false,
    })

    await handleClaim(params())

    expect(getCampaignMemberIds).not.toHaveBeenCalled()
    expect(claimCampaignCoupon).toHaveBeenCalledOnce()
  })

  it('QR image send fails (ok:false) → falls back to texting the code', async () => {
    vi.mocked(findMemberByPhone).mockResolvedValue(buildMember())
    vi.mocked(getCampaignById).mockResolvedValue(buildCampaign())
    vi.mocked(claimCampaignCoupon).mockResolvedValue({
      coupon: buildCoupon({ code: 'QRFAIL1' }), alreadyClaimed: false,
    })
    vi.mocked(sendImageMessage).mockResolvedValue({
      ok: false, kapsoMessageId: null, raw: null, error: { title: 'send_failed' },
    })

    await handleClaim(params())

    // coupon still minted; customer gets the code as text instead of a silent no-op
    expect(claimCampaignCoupon).toHaveBeenCalledOnce()
    expect(sendTextMessage).toHaveBeenLastCalledWith(
      'pn-1', '85261234567', expect.stringContaining('QRFAIL1')
    )
  })

  it('unexpected error → English fallback text (never throws)', async () => {
    vi.mocked(findMemberByPhone).mockResolvedValue(buildMember())
    vi.mocked(getCampaignById).mockResolvedValue(buildCampaign())
    vi.mocked(claimCampaignCoupon).mockRejectedValue(new Error('boom'))

    await expect(handleClaim(params())).resolves.not.toThrow()

    expect(sendTextMessage).toHaveBeenLastCalledWith(
      'pn-1', '85261234567', expect.stringContaining('went wrong')
    )
  })
})

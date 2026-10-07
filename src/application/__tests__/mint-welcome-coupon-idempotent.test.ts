// INT-001 WI-4 (OD-15 amendment): frozen suite for the idempotent mint.
// "A crash between mint and send, or a plain retry, must land exactly one
// coupon" -- covered by the check-first path (the normal retry case) and
// the catch-and-re-select fallback (a genuine concurrent race).

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/coupon-factory')
vi.mock('@/infrastructure/supabase/repositories/coupon-repository')

import { mintWelcomeCouponIdempotent } from '../mint-welcome-coupon-idempotent'
import { createCampaignCoupon, createWelcomeCoupon } from '@/infrastructure/supabase/repositories/coupon-factory'
import {
  findCouponByMemberAndCampaign,
  findWelcomeCouponByMember,
} from '@/infrastructure/supabase/repositories/coupon-repository'
import type { Coupon } from '@/domain/entities/coupon'
import type { Campaign } from '@/domain/entities/campaign'

function coupon(overrides: Partial<Coupon> = {}): Coupon {
  return {
    id: 'cpn-1',
    restaurantId: 'rest-1',
    type: 'promo',
    code: 'ABC123',
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
    campaignId: 'camp-1',
    title: null,
    description: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Coupon
}

function campaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 'camp-1',
    restaurantId: 'rest-1',
    name: 'Welcome',
    type: 'welcome',
    template: 'hi {{name}}',
    templateEn: null,
    templateZhHk: null,
    imageUrlEn: null,
    imageUrlZhHk: null,
    couponConfig: { discountType: 'percentage', discountValue: 10, expiresInDays: 30 },
    schedule: null,
    scheduledAt: null,
    status: 'active',
    failureReason: null,
    isChargeable: true,
    chargeableSentCount: 0,
    nonChargeableSentCount: 0,
    redeemedCount: 0,
    whatsappTemplateId: 'tpl-1',
    targetAudience: 'all',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('mintWelcomeCouponIdempotent (INT-001 WI-4, OD-15)', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('welcome campaign present', () => {
    it('mints a fresh campaign coupon when none exists yet', async () => {
      vi.mocked(findCouponByMemberAndCampaign).mockResolvedValue(null)
      vi.mocked(createCampaignCoupon).mockResolvedValue({ code: 'NEW1', id: 'cpn-new' })

      const result = await mintWelcomeCouponIdempotent('rest-1', 'm-1', 'Ada', campaign())

      expect(result).toEqual({ code: 'NEW1', id: 'cpn-new' })
      expect(createCampaignCoupon).toHaveBeenCalledWith('rest-1', 'm-1', campaign(), 'Ada')
    })

    it('retry after a crash between mint and send: finds the existing coupon, never mints again', async () => {
      vi.mocked(findCouponByMemberAndCampaign).mockResolvedValue(coupon({ code: 'EXIST1' }))

      const result = await mintWelcomeCouponIdempotent('rest-1', 'm-1', 'Ada', campaign())

      expect(result).toEqual({ code: 'EXIST1', id: 'cpn-1' })
      expect(createCampaignCoupon).not.toHaveBeenCalled()
    })

    it('a genuine concurrent race (check-first misses, insert 23505s) re-selects once and recovers', async () => {
      vi.mocked(findCouponByMemberAndCampaign)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(coupon({ code: 'RACE1' }))
      vi.mocked(createCampaignCoupon).mockRejectedValue(
        new Error('Failed to generate unique coupon code after 3 attempts')
      )

      const result = await mintWelcomeCouponIdempotent('rest-1', 'm-1', 'Ada', campaign())

      expect(result).toEqual({ code: 'RACE1', id: 'cpn-1' })
      expect(findCouponByMemberAndCampaign).toHaveBeenCalledTimes(2)
    })

    it('a genuine mint failure with no recoverable row rethrows', async () => {
      vi.mocked(findCouponByMemberAndCampaign).mockResolvedValue(null)
      const err = new Error('campaign has no coupon_config')
      vi.mocked(createCampaignCoupon).mockRejectedValue(err)

      await expect(mintWelcomeCouponIdempotent('rest-1', 'm-1', 'Ada', campaign())).rejects.toThrow(
        'campaign has no coupon_config'
      )
    })
  })

  describe('no campaign (campaign-less fallback)', () => {
    it('mints a fresh welcome coupon when none exists yet', async () => {
      vi.mocked(findWelcomeCouponByMember).mockResolvedValue(null)
      vi.mocked(createWelcomeCoupon).mockResolvedValue({ code: 'FALLBACK1', id: 'cpn-fb' })

      const result = await mintWelcomeCouponIdempotent('rest-1', 'm-1', 'Ada', null)

      expect(result).toEqual({ code: 'FALLBACK1', id: 'cpn-fb' })
      expect(createWelcomeCoupon).toHaveBeenCalledWith('rest-1', 'm-1')
      expect(findCouponByMemberAndCampaign).not.toHaveBeenCalled()
    })

    it('retry finds the existing welcome coupon, never mints again', async () => {
      vi.mocked(findWelcomeCouponByMember).mockResolvedValue(coupon({ type: 'welcome', code: 'EXIST2', campaignId: null }))

      const result = await mintWelcomeCouponIdempotent('rest-1', 'm-1', 'Ada', null)

      expect(result).toEqual({ code: 'EXIST2', id: 'cpn-1' })
      expect(createWelcomeCoupon).not.toHaveBeenCalled()
    })

    // G-2 (Grok review): mirrors the campaign-present race test above --
    // this describe block never had one. Before migration 076
    // (uniq_coupons_welcome_member) this catch-and-re-select path was DEAD
    // CODE: `coupon-repository.ts`'s own comment said a 23505 here "would
    // never happen for this type", so a genuine concurrent race (both
    // requests' check-first read miss, both insert) landed TWO welcome
    // coupons in production with no error at all. The migration makes the
    // loser's insert actually 23505; this test pins the application-level
    // recovery that constraint now makes reachable.
    it('G-2: a genuine concurrent race (check-first misses, insert throws a unique-violation) re-selects once and recovers to ONE coupon', async () => {
      vi.mocked(findWelcomeCouponByMember)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(coupon({ type: 'welcome', code: 'RACE2', campaignId: null }))
      vi.mocked(createWelcomeCoupon).mockRejectedValue(
        new Error('Failed to generate unique coupon code after 3 attempts')
      )

      const result = await mintWelcomeCouponIdempotent('rest-1', 'm-1', 'Ada', null)

      expect(result).toEqual({ code: 'RACE2', id: 'cpn-1' })
      expect(findWelcomeCouponByMember).toHaveBeenCalledTimes(2)
      expect(createWelcomeCoupon).toHaveBeenCalledTimes(1)
    })

    it('a genuine mint failure with no recoverable row rethrows', async () => {
      vi.mocked(findWelcomeCouponByMember).mockResolvedValue(null)
      const err = new Error('some other database error')
      vi.mocked(createWelcomeCoupon).mockRejectedValue(err)

      await expect(mintWelcomeCouponIdempotent('rest-1', 'm-1', 'Ada', null)).rejects.toThrow(
        'some other database error'
      )
    })
  })
})

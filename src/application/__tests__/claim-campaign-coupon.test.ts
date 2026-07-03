import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Campaign } from '@/domain/entities/campaign'
import type { Member } from '@/domain/entities/member'
import type { Coupon } from '@/domain/entities/coupon'

vi.mock('@/infrastructure/supabase/repositories/coupon-repository', () => ({
  findCouponByMemberAndCampaign: vi.fn(),
}))
vi.mock('../execute-campaign-coupon', () => ({
  createCampaignBroadcastCoupon: vi.fn(),
}))
vi.mock('@/domain/value-objects/coupon-code', () => ({
  generateCouponCode: vi.fn(() => 'NEWCODE1'),
}))

import { claimCampaignCoupon } from '@/application/claim-campaign-coupon'
import { findCouponByMemberAndCampaign } from '@/infrastructure/supabase/repositories/coupon-repository'
import { createCampaignBroadcastCoupon } from '../execute-campaign-coupon'

function buildCampaign(o: Partial<Campaign> = {}): Campaign {
  return {
    id: 'camp-1', restaurantId: 'r-1', name: 'Summer Promo', type: 'promo',
    template: '', templateEn: null, templateZhHk: null, imageUrlEn: null,
    imageUrlZhHk: null, couponConfig: null, schedule: null, scheduledAt: null,
    status: 'active', isChargeable: true, chargeableSentCount: 0,
    nonChargeableSentCount: 0, redeemedCount: 0, whatsappTemplateId: null,
    targetAudience: 'all', createdAt: '2024-01-01T00:00:00Z', ...o,
  }
}

function buildMember(o: Partial<Member> = {}): Member {
  return {
    id: 'm-1', restaurantId: 'r-1', phone: '85261234567', name: 'Ada',
    pointsBalance: 0, status: 'active', joinedAt: '2024-01-01T00:00:00Z',
    lastVisitAt: null, preferredLanguage: 'en', pmmThrottledUntil: null,
    unreachableAt: null, ...o,
  }
}

function buildCoupon(o: Partial<Coupon> = {}): Coupon {
  return {
    id: 'c-1', restaurantId: 'r-1', type: 'promo', code: 'EXISTING1',
    status: 'active', memberId: 'm-1', expiresAt: null, redeemedAt: null,
    discountType: null, discountValue: null, maxUses: 1, currentUses: 0,
    isActive: true, isChargeable: true, title: null, description: null,
    campaignId: 'camp-1', createdAt: '2024-01-01T00:00:00Z', ...o,
  }
}

// Mirrors what coupon-repository.createCoupon actually throws on a Postgres
// unique-constraint violation (SQLSTATE 23505) for the migration-053 index.
function uniqueViolation(): Error {
  return new Error(
    'createCoupon: duplicate key value violates unique constraint "uniq_coupon_campaign_member"'
  )
}

describe('claimCampaignCoupon', () => {
  const campaign = buildCampaign()
  const member = buildMember()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the existing coupon (alreadyClaimed) without minting', async () => {
    const existing = buildCoupon()
    vi.mocked(findCouponByMemberAndCampaign).mockResolvedValue(existing)

    const result = await claimCampaignCoupon({ campaign, member })

    expect(result).toEqual({ coupon: existing, alreadyClaimed: true })
    expect(createCampaignBroadcastCoupon).not.toHaveBeenCalled()
  })

  it('mints a fresh coupon when none exists', async () => {
    const minted = buildCoupon({ id: 'c-2', code: 'NEWCODE1' })
    vi.mocked(findCouponByMemberAndCampaign).mockResolvedValue(null)
    vi.mocked(createCampaignBroadcastCoupon).mockResolvedValue(minted)

    const result = await claimCampaignCoupon({ campaign, member })

    expect(result).toEqual({ coupon: minted, alreadyClaimed: false })
    expect(createCampaignBroadcastCoupon).toHaveBeenCalledWith(
      campaign, member, 'NEWCODE1', campaign.name
    )
  })

  it('recovers from a double-tap race (23505) by re-fetching the winner', async () => {
    const winner = buildCoupon({ id: 'c-3', code: 'RACEWIN1' })
    vi.mocked(findCouponByMemberAndCampaign)
      .mockResolvedValueOnce(null) // initial lookup: none yet
      .mockResolvedValueOnce(winner) // post-conflict re-fetch: the other tap won
    vi.mocked(createCampaignBroadcastCoupon).mockRejectedValue(uniqueViolation())

    const result = await claimCampaignCoupon({ campaign, member })

    expect(result).toEqual({ coupon: winner, alreadyClaimed: true })
  })

  it('rethrows a non-unique-violation error (does not swallow real failures)', async () => {
    vi.mocked(findCouponByMemberAndCampaign).mockResolvedValue(null)
    vi.mocked(createCampaignBroadcastCoupon).mockRejectedValue(
      new Error('createCoupon: connection reset')
    )

    await expect(claimCampaignCoupon({ campaign, member })).rejects.toThrow(
      'connection reset'
    )
  })

  it('rethrows the 23505 error if the re-fetch still finds nothing', async () => {
    vi.mocked(findCouponByMemberAndCampaign).mockResolvedValue(null)
    vi.mocked(createCampaignBroadcastCoupon).mockRejectedValue(uniqueViolation())

    await expect(claimCampaignCoupon({ campaign, member })).rejects.toThrow(
      'uniq_coupon_campaign_member'
    )
  })
})

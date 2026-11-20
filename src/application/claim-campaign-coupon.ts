import { findCouponByMemberAndCampaign } from '@/infrastructure/supabase/repositories/coupon-repository'
import { isCouponUniqueViolation } from '@/infrastructure/supabase/repositories/coupon-error'
import { generateCouponCode } from '@/domain/value-objects/coupon-code'
import { createCampaignBroadcastCoupon } from './execute-campaign-coupon'
import type { Campaign } from '@/domain/entities/campaign'
import type { Member } from '@/domain/entities/member'
import type { Coupon } from '@/domain/entities/coupon'

interface ClaimParams {
  campaign: Campaign
  // Only the id is needed to key + mint the coupon; the webhook's
  // findMemberByPhone returns a narrow member shape (not the full entity).
  member: Pick<Member, 'id'>
}

export interface ClaimResult {
  coupon: Coupon
  alreadyClaimed: boolean
}

/**
 * CAMP-001: mint (or return the existing) campaign coupon for a claim tap.
 *
 * Idempotent on two levels: an app-level pre-check ({@link findCouponByMemberAndCampaign})
 * covers the common re-tap, and a Postgres 23505 catch covers the concurrent
 * double-tap race that slips past the pre-check (both taps see no row, both
 * insert; the partial unique index from migration 053 lets exactly one win).
 */
export async function claimCampaignCoupon(
  { campaign, member }: ClaimParams
): Promise<ClaimResult> {
  const existing = await findCouponByMemberAndCampaign(
    campaign.restaurantId, member.id, campaign.id
  )
  if (existing) return { coupon: existing, alreadyClaimed: true }

  return mintOrRecover({ campaign, member })
}

async function mintOrRecover(
  { campaign, member }: ClaimParams
): Promise<ClaimResult> {
  const code = generateCouponCode()
  const description = campaign.name ?? ''
  try {
    const coupon = await createCampaignBroadcastCoupon(campaign, member, code, description)
    return { coupon, alreadyClaimed: false }
  } catch (err) {
    if (!isCouponUniqueViolation(err)) throw err
    const winner = await findCouponByMemberAndCampaign(
      campaign.restaurantId, member.id, campaign.id
    )
    if (!winner) throw err
    return { coupon: winner, alreadyClaimed: true }
  }
}

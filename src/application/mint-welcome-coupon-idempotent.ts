// INT-001 WI-4 (OD-15 amendment): mint the welcome coupon idempotently,
// keyed on (member_id, welcome_campaign_id) when a campaign is resolved,
// else on (member_id) for the campaign-less fallback. A crash between mint
// and send, or a plain BullMQ retry, must land exactly one coupon -- never
// a second one -- when `process-welcome-send-job.ts` re-runs this on retry.
//
// Check-first, not catch-23505-from-createCampaignCoupon: that function's
// own MAX_CODE_ATTEMPTS retry loop (coupon-factory.ts) treats ANY unique
// violation message the same way (retry with a fresh CODE), which cannot
// recover a (campaign_id, member_id) collision -- every retry collides on
// the SAME pair again and it exhausts into a generic error. Checking first
// means the normal retry path (this job re-running after an earlier
// successful mint) never reaches createCampaignCoupon/createWelcomeCoupon
// at all. The catch-and-re-select below is belt-and-braces for a genuine
// concurrent race, not the primary idempotency mechanism.

import type { Campaign } from '@/domain/entities/campaign'
import { createCampaignCoupon, createWelcomeCoupon } from '@/infrastructure/supabase/repositories/coupon-factory'
import {
  findCouponByMemberAndCampaign,
  findWelcomeCouponByMember,
} from '@/infrastructure/supabase/repositories/coupon-repository'

export interface MintedWelcomeCoupon {
  code: string
  id: string
}

export async function mintWelcomeCouponIdempotent(
  restaurantId: string,
  memberId: string,
  memberName: string,
  campaign: Campaign | null
): Promise<MintedWelcomeCoupon> {
  if (campaign) {
    return mintCampaignCouponIdempotent(restaurantId, memberId, memberName, campaign)
  }
  return mintFallbackWelcomeCouponIdempotent(restaurantId, memberId)
}

async function mintCampaignCouponIdempotent(
  restaurantId: string,
  memberId: string,
  memberName: string,
  campaign: Campaign
): Promise<MintedWelcomeCoupon> {
  const existing = await findCouponByMemberAndCampaign(restaurantId, memberId, campaign.id)
  if (existing) return { code: existing.code, id: existing.id }

  try {
    return await createCampaignCoupon(restaurantId, memberId, campaign, memberName)
  } catch (err) {
    const recovered = await findCouponByMemberAndCampaign(restaurantId, memberId, campaign.id)
    if (recovered) return { code: recovered.code, id: recovered.id }
    throw err
  }
}

async function mintFallbackWelcomeCouponIdempotent(
  restaurantId: string,
  memberId: string
): Promise<MintedWelcomeCoupon> {
  const existing = await findWelcomeCouponByMember(restaurantId, memberId)
  if (existing) return { code: existing.code, id: existing.id }

  try {
    return await createWelcomeCoupon(restaurantId, memberId)
  } catch (err) {
    const recovered = await findWelcomeCouponByMember(restaurantId, memberId)
    if (recovered) return { code: recovered.code, id: recovered.id }
    throw err
  }
}

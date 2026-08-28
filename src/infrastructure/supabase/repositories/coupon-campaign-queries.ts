// Bulk campaign-coupon lookup for the broadcast re-run path (#131 / CAMP-002).
// Lives beside `coupon-repository.ts` (already at the size limit) and only
// reads.

import { createServerSupabaseClient } from '../client'
import { Coupon } from '@/domain/entities/coupon'
import { mapRowToCoupon } from './coupon-mapper'

/**
 * Existing `promo` coupons for (campaign, member) pairs — at most one per
 * member (migration 053's partial unique index). ONE `IN` query per chunk so
 * an eager re-run can reuse the code the member already holds instead of
 * sending a body that promises a code no coupon carries.
 */
export async function findCouponsByMembersAndCampaign(args: {
  restaurantId: string
  campaignId: string
  memberIds: string[]
}): Promise<Map<string, Coupon>> {
  if (args.memberIds.length === 0) return new Map()
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('coupons')
    .select('*')
    .eq('restaurant_id', args.restaurantId)
    .eq('campaign_id', args.campaignId)
    .eq('type', 'promo')
    .in('member_id', args.memberIds)
  if (error) throw new Error(`findCouponsByMembersAndCampaign: ${error.message}`)
  const out = new Map<string, Coupon>()
  for (const row of data ?? []) {
    const coupon = mapRowToCoupon(row)
    if (coupon.memberId) out.set(coupon.memberId, coupon)
  }
  return out
}

// Per-chunk prefetch that makes campaign re-execution at-most-once (#131 §4,
// CAMP-002 minimum). Two bulk reads, no per-member round-trips:
//   - the per-member ledger: who already has a counted (non-failed) body
//     send for this campaign → skipped, never re-sent or re-counted;
//   - eager mode only: the promo coupon each member already holds → its code
//     is reused in the body instead of minting a second one (migration 053
//     forbids it anyway, and the first run's code is what the tenant sees).

import { findMemberIdsWithCountedSend } from '@/infrastructure/supabase/repositories/whatsapp-message-ledger-queries'
import { findCouponsByMembersAndCampaign } from '@/infrastructure/supabase/repositories/coupon-campaign-queries'
import { isClaimTemplate } from '@/domain/services/campaign-mode'
import type { Coupon } from '@/domain/entities/coupon'
import type { Member } from '@/domain/entities/member'
import type { SendContext } from './execute-campaign-batch'

export interface RerunPrefetch {
  countedMemberIds: Set<string>
  existingCoupons: Map<string, Coupon>
}

export const EMPTY_PREFETCH: RerunPrefetch = Object.freeze({
  countedMemberIds: new Set<string>(),
  existingCoupons: new Map<string, Coupon>(),
})

export async function loadRerunPrefetch(
  members: Member[],
  ctx: SendContext
): Promise<RerunPrefetch> {
  const memberIds = members.map((m) => m.id)
  const campaignId = ctx.campaign.id
  const restaurantId = ctx.campaign.restaurantId
  const [countedMemberIds, existingCoupons] = await Promise.all([
    // Without tracking there is no ledger to consult — pre-#131 behaviour.
    ctx.trackingEnabled
      ? findMemberIdsWithCountedSend({ campaignId, restaurantId, memberIds })
      : Promise.resolve(new Set<string>()),
    // Claim mode mints nothing at broadcast, so there is nothing to reuse.
    isClaimTemplate(ctx.template)
      ? Promise.resolve(new Map<string, Coupon>())
      : findCouponsByMembersAndCampaign({ restaurantId, campaignId, memberIds }),
  ])
  return { countedMemberIds, existingCoupons }
}

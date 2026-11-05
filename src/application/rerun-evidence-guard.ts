import type { Campaign } from '@/domain/entities/campaign'
import {
  countCampaignBodyRows,
  countFailedBodyRowsWithoutMetaCode,
} from '@/infrastructure/supabase/repositories/whatsapp-message-campaign-queries'
import { countExpiredCampaignCoupons } from '@/infrastructure/supabase/repositories/coupon-campaign-queries'
import { isMessageTrackingEnabled } from './message-tracking-flag'

export type RerunEvidenceRefusal = 'delivery_unconfirmed' | 'coupons_expired'

/**
 * CAMP-014: a re-run messages real customers, so it proceeds only when our rows
 * prove Meta definitively rejected the earlier sends. Non-failed body rows do not
 * refuse, because the per-member ledger skips those members. Exact head counts,
 * no row reads. A query error propagates, so the caller fails closed.
 */
export async function findRerunEvidenceRefusal(
  campaign: Campaign
): Promise<RerunEvidenceRefusal | null> {
  // Without tracking the ledger is empty, so a re-run would send to everyone.
  if (!isMessageTrackingEnabled()) return 'delivery_unconfirmed'
  const scope = { campaignId: campaign.id, restaurantId: campaign.restaurantId }
  if ((await countCampaignBodyRows(scope)) === 0) return 'delivery_unconfirmed'
  if ((await countFailedBodyRowsWithoutMetaCode(scope)) > 0) return 'delivery_unconfirmed'
  // The broadcast skips a member holding a dead coupon, so an expired campaign
  // would read as a clean run that reached nobody.
  if ((await countExpiredCampaignCoupons(scope)) > 0) return 'coupons_expired'
  return null
}

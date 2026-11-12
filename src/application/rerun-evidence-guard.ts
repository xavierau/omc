import type { Campaign } from '@/domain/entities/campaign'
import {
  countCampaignBodyRows,
  countFailedBodyRowsWithoutMetaCode,
  countQueuedBodyRowsWithoutWamid,
} from '@/infrastructure/supabase/repositories/whatsapp-message-campaign-queries'
import { countExpiredCampaignCoupons } from '@/infrastructure/supabase/repositories/coupon-campaign-queries'
import { isMessageTrackingEnabled } from './message-tracking-flag'

export type RerunEvidenceRefusal = 'delivery_unconfirmed' | 'coupons_expired'

/**
 * CAMP-014: a re-run messages real customers, so it proceeds only when our rows
 * prove Meta definitively rejected the earlier sends: every failed body row must
 * carry Meta's numeric code, and no body row may be queued with no wamid. Delivery of
 * that queued row is unknown, and the per-member ledger stops skipping its member once
 * the sweep flips it, which can happen after this check. Other non-failed body rows do
 * not refuse: the sweep never touches them, so the ledger skips those members unless
 * Meta itself rejects the send. Exact head counts, no row reads. A query error
 * propagates, so the caller fails closed.
 */
export async function findRerunEvidenceRefusal(
  campaign: Campaign
): Promise<RerunEvidenceRefusal | null> {
  // Without tracking the ledger is empty, so a re-run would send to everyone.
  if (!isMessageTrackingEnabled()) return 'delivery_unconfirmed'
  const scope = { campaignId: campaign.id, restaurantId: campaign.restaurantId }
  if ((await countCampaignBodyRows(scope)) === 0) return 'delivery_unconfirmed'
  // Queued before failed: the sweep moves a row from one to the other, so a tick
  // between these two counts cannot hide it from both.
  if ((await countQueuedBodyRowsWithoutWamid(scope)) > 0) return 'delivery_unconfirmed'
  if ((await countFailedBodyRowsWithoutMetaCode(scope)) > 0) return 'delivery_unconfirmed'
  // The broadcast skips a member holding a dead coupon, so an expired campaign
  // would read as a clean run that reached nobody.
  if ((await countExpiredCampaignCoupons(scope)) > 0) return 'coupons_expired'
  return null
}

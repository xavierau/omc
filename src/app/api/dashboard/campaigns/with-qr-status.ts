// CAMP-014: attach QR visibility to a campaign's list response, absent when it
// does not apply or could not be read. Each read degrades OFF on its own (same
// contract as safeCampaignTemplateReviewStates): the warnings are layered on top
// of the list, so a failure here must never fail the list. The count depends on
// the flag: with no template read, no campaign is known to be QR-only, so no count.

import type { Campaign } from '@/domain/entities/campaign'
import {
  countFailedQrImagesByCampaign,
  findQrOnlyCampaignIds,
} from '@/application/build-campaign-qr-states'

export interface CampaignQrStates {
  qrOnlyIds: Set<string>
  qrFailedCounts: Map<string, number>
}

export function withQrStatus<T extends Campaign>(
  campaign: T,
  states: CampaignQrStates
): T & { qrOnlyCoupon?: true; qrFailedCount?: number } {
  const qrFailedCount = states.qrFailedCounts.get(campaign.id)
  return {
    ...campaign,
    ...(states.qrOnlyIds.has(campaign.id) ? { qrOnlyCoupon: true as const } : {}),
    ...(qrFailedCount !== undefined ? { qrFailedCount } : {}),
  }
}

export async function safeCampaignQrStates(
  restaurantId: string,
  campaigns: Campaign[]
): Promise<CampaignQrStates> {
  const qrOnlyIds = await findQrOnlyCampaignIds(restaurantId, campaigns).catch((error) => {
    console.error('Campaign QR-only enrichment failed (degrading OFF):', error)
    return new Set<string>()
  })
  const qrOnly = campaigns.filter((c) => qrOnlyIds.has(c.id))
  const qrFailedCounts = await countFailedQrImagesByCampaign(restaurantId, qrOnly).catch((error) => {
    console.error('Campaign QR failure count failed (degrading OFF):', error)
    return new Map<string, number>()
  })
  return { qrOnlyIds, qrFailedCounts }
}

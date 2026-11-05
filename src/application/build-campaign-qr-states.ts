// CAMP-014: per-campaign QR visibility for the dashboard campaigns list.
//   - qrOnly: one bulk template read, however many campaigns are listed.
//   - qrFailedCounts: one exact head count per campaign that has counted sends,
//     the only campaigns whose card can show it. Batched, so a long list cannot
//     open every connection at once.

import type { Campaign } from '@/domain/entities/campaign'
import { isQrOnlyCouponCampaign } from '@/domain/services/campaign-qr-only'
import { findManyByIdsForRestaurant } from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { countFailedCampaignQrImages } from '@/infrastructure/supabase/repositories/whatsapp-message-campaign-queries'

const COUNT_BATCH_SIZE = 10

export async function findQrOnlyCampaignIds(
  restaurantId: string,
  campaigns: Campaign[]
): Promise<Set<string>> {
  const ids = campaigns
    .map((c) => c.whatsappTemplateId)
    .filter((id): id is string => !!id)
  const templates = await findManyByIdsForRestaurant(Array.from(new Set(ids)), restaurantId)
  const byId = new Map(templates.map((t) => [t.id, t]))
  const qrOnly = campaigns.filter((c) =>
    isQrOnlyCouponCampaign({
      type: c.type,
      hasCouponConfig: Boolean(c.couponConfig),
      template: byId.get(c.whatsappTemplateId ?? '') ?? null,
    })
  )
  return new Set(qrOnly.map((c) => c.id))
}

export async function countFailedQrImagesByCampaign(
  restaurantId: string,
  campaigns: Campaign[]
): Promise<Map<string, number>> {
  const counted = campaigns.filter(
    (c) => c.chargeableSentCount + c.nonChargeableSentCount > 0
  )
  const counts = new Map<string, number>()
  for (let i = 0; i < counted.length; i += COUNT_BATCH_SIZE) {
    const batch = counted.slice(i, i + COUNT_BATCH_SIZE)
    const results = await Promise.all(
      batch.map((c) => countFailedCampaignQrImages({ campaignId: c.id, restaurantId }))
    )
    batch.forEach((c, index) => counts.set(c.id, results[index]))
  }
  return counts
}

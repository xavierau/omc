// CAMP-014: per-campaign QR visibility for the dashboard campaigns list.
//   - qrOnly: one bulk template read, however many campaigns are listed.
//   - qrFailedCounts: one exact head count per QR-only campaign that has counted
//     sends. A warning about undelivered codes only holds where the QR is the only
//     copy of the code, and the card needs counted sends to show it. Batched, so a
//     long list cannot open every connection at once. Counts from the last enqueue,
//     so a re-run stops counting the earlier run.

import type { Campaign } from '@/domain/entities/campaign'
import { isQrOnlyCouponCampaign } from '@/domain/services/campaign-qr-only'
import { findManyByIdsForRestaurant } from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { countFailedCampaignQrImages } from '@/infrastructure/supabase/repositories/whatsapp-message-campaign-queries'
import { appBaseUrl } from '@/infrastructure/config/app-url'

const COUNT_BATCH_SIZE = 10

export async function findQrOnlyCampaignIds(
  restaurantId: string,
  campaigns: Campaign[]
): Promise<Set<string>> {
  // A coupon-less campaign can never be QR-only, so its template is not read.
  const ids = campaigns
    .filter((c) => c.couponConfig)
    .map((c) => c.whatsappTemplateId)
    .filter((id): id is string => !!id)
  const templates = await findManyByIdsForRestaurant(Array.from(new Set(ids)), restaurantId)
  const byId = new Map(templates.map((t) => [t.id, t]))
  const qrOnly = campaigns.filter((c) =>
    isQrOnlyCouponCampaign({
      type: c.type,
      hasCouponConfig: Boolean(c.couponConfig),
      template: byId.get(c.whatsappTemplateId ?? '') ?? null,
      appUrl: appBaseUrl(),
    })
  )
  return new Set(qrOnly.map((c) => c.id))
}

export async function countFailedQrImagesByCampaign(
  restaurantId: string,
  qrOnlyCampaigns: Campaign[]
): Promise<Map<string, number>> {
  const counted = qrOnlyCampaigns.filter(
    (c) => c.chargeableSentCount + c.nonChargeableSentCount > 0
  )
  const counts = new Map<string, number>()
  for (let i = 0; i < counted.length; i += COUNT_BATCH_SIZE) {
    const batch = counted.slice(i, i + COUNT_BATCH_SIZE)
    const results = await Promise.all(
      batch.map((c) =>
        countFailedCampaignQrImages({
          campaignId: c.id,
          restaurantId,
          queuedSince: c.lastEnqueuedAt,
        })
      )
    )
    batch.forEach((c, index) => counts.set(c.id, results[index]))
  }
  return counts
}

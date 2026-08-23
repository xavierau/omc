// Issue #102 fix 4: attach the computed template-review state onto a
// campaign's JSON response ONLY when one applies (the campaign references
// a MARKETING template) — `templateReview` stays absent otherwise, per the
// dashboard-campaigns API contract. Shared by the list route and the
// single-campaign GET route.

import type { Campaign } from '@/domain/entities/campaign'
import {
  buildCampaignTemplateReviewStates,
  type CampaignTemplateReviewState,
} from '@/application/build-campaign-template-review-states'

export function withTemplateReview(
  campaign: Campaign,
  states: Map<string, CampaignTemplateReviewState>
): Campaign & { templateReview?: CampaignTemplateReviewState } {
  const templateReview = states.get(campaign.id)
  return templateReview ? { ...campaign, templateReview } : { ...campaign }
}

/**
 * Degrade OFF (REPLY-001 precedent) — shared by the list route and the
 * single-campaign GET route (review round 3, #102 item 2) so both behave
 * identically: the Send-button explanation is a nice-to-have layered on
 * top of the campaign response. If the enrichment subsystem (trust check /
 * template lookup / review-queue lookup) errors, the campaign(s) must
 * still load — just without `templateReview`, never a 500.
 */
export async function safeCampaignTemplateReviewStates(
  restaurantId: string,
  campaigns: Campaign[]
): Promise<Map<string, CampaignTemplateReviewState>> {
  try {
    return await buildCampaignTemplateReviewStates(restaurantId, campaigns)
  } catch (error) {
    console.error('Campaign template-review enrichment failed (degrading OFF):', error)
    return new Map()
  }
}

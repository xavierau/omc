// Issue #102 fix 4: attach the computed template-review state onto a
// campaign's JSON response ONLY when one applies (the campaign references
// a MARKETING template) — `templateReview` stays absent otherwise, per the
// dashboard-campaigns API contract. Shared by the list route and the
// single-campaign GET route.

import type { Campaign } from '@/domain/entities/campaign'
import type { CampaignTemplateReviewState } from '@/application/build-campaign-template-review-states'

export function withTemplateReview(
  campaign: Campaign,
  states: Map<string, CampaignTemplateReviewState>
): Campaign & { templateReview?: CampaignTemplateReviewState } {
  const templateReview = states.get(campaign.id)
  return templateReview ? { ...campaign, templateReview } : { ...campaign }
}

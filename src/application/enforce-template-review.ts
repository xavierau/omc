// WAQ-011: send-time enforcement wrapper around `checkTemplateReview`.
//
// Thin glue: gate the marketing send by an approved review row when the
// tenant isn't trusted. UTILITY templates and inline-only campaigns skip
// — the queue exists to police bulk marketing only. Lives in its own
// file (rather than inside `execute-campaign.ts`) so the dependency
// surface of the executor stays small enough to keep the file under the
// 150-line cap.

import type { Campaign } from '@/domain/entities/campaign'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import { CampaignGuardrailError } from './campaign-guardrail-error'
import { checkTemplateReview } from './check-template-review'

export interface EnforceTemplateReviewArgs {
  campaign: Campaign
  restaurantId: string
  template: WhatsAppTemplate | null
}

export async function enforceTemplateReview(
  args: EnforceTemplateReviewArgs
): Promise<void> {
  const { campaign, restaurantId, template } = args
  if (!template || template.category !== 'MARKETING') return
  const result = await checkTemplateReview({
    restaurantId,
    templateName: template.name,
  })
  if (result.allowed) return
  throw new CampaignGuardrailError([
    `Template '${template.name}' requires platform approval before sending (campaign ${campaign.id})`,
  ])
}

// WAQ-011: tenant-side action — submit a marketing template for platform
// review. Returns the new row's id so the caller can correlate with the
// admin queue (e.g. a "submitted, awaiting review" toast).
//
// Authorization is handled at the route layer — anyone authenticated for
// the tenant can submit. The unique partial index on
// (restaurant_id, template_name) WHERE status IN ('pending','approved')
// ensures there's only ever one active review per template, so a double-
// click cannot create two pending rows.

import { randomUUID } from 'crypto'
import { TemplateReview } from '@/domain/entities/template-review'
import { insertTemplateReview } from '@/infrastructure/supabase/repositories/template-review-repository'

export interface SubmitTemplateReviewArgs {
  restaurantId: string
  templateName: string
  submittedBy: string
  templateId?: string | null
  targetAudienceSize?: number | null
  targetAudienceQuery?: Record<string, unknown> | null
  contentPreview?: string | null
}

export async function submitTemplateReview(
  args: SubmitTemplateReviewArgs
): Promise<string> {
  const id = randomUUID()
  const review = TemplateReview.submit({
    id,
    restaurantId: args.restaurantId,
    templateName: args.templateName,
    submittedBy: args.submittedBy,
    templateId: args.templateId ?? null,
    targetAudienceSize: args.targetAudienceSize ?? null,
    targetAudienceQuery: args.targetAudienceQuery ?? null,
    contentPreview: args.contentPreview ?? null,
  })
  await insertTemplateReview(review)
  return id
}

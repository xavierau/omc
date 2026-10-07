import {
  TemplateReview,
  type TemplateReviewProps,
} from '@/domain/entities/template-review'
import type { ReviewStatus } from '@/domain/value-objects/review-status'

export interface TemplateReviewRow {
  id: string
  restaurant_id: string
  template_id: string | null
  template_name: string
  target_audience_size: number | null
  target_audience_query: Record<string, unknown> | null
  content_preview: string | null
  status: ReviewStatus
  submitted_by: string | null
  submitted_at: string
  reviewed_by: string | null
  reviewed_at: string | null
  review_notes: string | null
}

export function toEntity(row: TemplateReviewRow): TemplateReview {
  // submittedBy is non-null on entities created via `submit`, but DB rows
  // pre-dating this code OR backfilled by the platform may lack it. Coerce
  // null -> 'unknown' so the entity invariant is preserved (it never reads
  // submittedBy as null) without throwing on legacy rows.
  const props: TemplateReviewProps = {
    id: row.id,
    restaurantId: row.restaurant_id,
    templateId: row.template_id,
    templateName: row.template_name,
    targetAudienceSize: row.target_audience_size,
    targetAudienceQuery: row.target_audience_query,
    contentPreview: row.content_preview,
    status: row.status,
    submittedBy: row.submitted_by ?? 'unknown',
    submittedAt: row.submitted_at,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    reviewNotes: row.review_notes,
  }
  return TemplateReview.fromProps(props)
}

export function toRow(review: TemplateReview): TemplateReviewRow {
  const s = review.snapshot
  return {
    id: s.id,
    restaurant_id: s.restaurantId,
    template_id: s.templateId,
    template_name: s.templateName,
    target_audience_size: s.targetAudienceSize,
    target_audience_query: s.targetAudienceQuery,
    content_preview: s.contentPreview,
    status: s.status,
    submitted_by: s.submittedBy,
    submitted_at: s.submittedAt,
    reviewed_by: s.reviewedBy,
    reviewed_at: s.reviewedAt,
    review_notes: s.reviewNotes,
  }
}

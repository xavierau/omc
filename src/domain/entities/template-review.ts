// WAQ-011: domain entity for `template_review_queue` rows.
//
// Three rules baked in here so they cannot drift:
//   1) `submit` always lands as `pending`.
//   2) Decisions (`approve` / `reject` / `requestChanges`) only fire from
//      `pending`. A second decision throws — re-decisions require a fresh
//      submission row.
//   3) Reject + requestChanges REQUIRE notes. Approve notes are optional.
//
// Returned values are NEW instances (immutable transitions) so the caller
// can hold both before/after snapshots without aliasing.

import type { ReviewStatus } from '../value-objects/review-status'

export interface TemplateReviewProps {
  id: string
  restaurantId: string
  templateId: string | null
  templateName: string
  targetAudienceSize: number | null
  targetAudienceQuery: Record<string, unknown> | null
  contentPreview: string | null
  status: ReviewStatus
  submittedBy: string
  submittedAt: string
  reviewedBy: string | null
  reviewedAt: string | null
  reviewNotes: string | null
}

export interface SubmitTemplateReviewInput {
  id: string
  restaurantId: string
  templateId?: string | null
  templateName: string
  targetAudienceSize?: number | null
  targetAudienceQuery?: Record<string, unknown> | null
  contentPreview?: string | null
  submittedBy: string
  submittedAt?: Date
}

export class TemplateReview {
  private constructor(private readonly props: TemplateReviewProps) {}

  static submit(input: SubmitTemplateReviewInput): TemplateReview {
    assertNonEmpty('restaurantId', input.restaurantId)
    assertNonEmpty('templateName', input.templateName)
    assertNonEmpty('submittedBy', input.submittedBy)
    return new TemplateReview({
      id: input.id,
      restaurantId: input.restaurantId,
      templateId: input.templateId ?? null,
      templateName: input.templateName,
      targetAudienceSize: input.targetAudienceSize ?? null,
      targetAudienceQuery: input.targetAudienceQuery ?? null,
      contentPreview: input.contentPreview ?? null,
      status: 'pending',
      submittedBy: input.submittedBy,
      submittedAt: (input.submittedAt ?? new Date()).toISOString(),
      reviewedBy: null,
      reviewedAt: null,
      reviewNotes: null,
    })
  }

  static fromProps(props: TemplateReviewProps): TemplateReview {
    return new TemplateReview(props)
  }

  approve(reviewerId: string, notes?: string): TemplateReview {
    return this.transition('approved', reviewerId, notes ?? null, false)
  }

  reject(reviewerId: string, notes: string): TemplateReview {
    return this.transition('rejected', reviewerId, notes, true)
  }

  requestChanges(reviewerId: string, notes: string): TemplateReview {
    return this.transition('changes_requested', reviewerId, notes, true)
  }

  private transition(
    next: ReviewStatus,
    reviewerId: string,
    notes: string | null,
    notesRequired: boolean
  ): TemplateReview {
    if (this.props.status !== 'pending') {
      throw new Error(
        `TemplateReview: cannot ${next} from status='${this.props.status}' (requires pending)`
      )
    }
    assertNonEmpty('reviewerId', reviewerId)
    if (notesRequired && (!notes || !notes.trim())) {
      throw new Error(`TemplateReview: notes are required to ${next}`)
    }
    return new TemplateReview({
      ...this.props,
      status: next,
      reviewedBy: reviewerId,
      reviewedAt: new Date().toISOString(),
      reviewNotes: notes,
    })
  }

  get snapshot(): Readonly<TemplateReviewProps> {
    return this.props
  }
}

function assertNonEmpty(field: string, value: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`TemplateReview: ${field} is required`)
  }
}

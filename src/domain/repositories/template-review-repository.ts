// WAQ-011: contract for `template_review_queue` writer/reader.
//
// The Supabase implementation lives in
// `src/infrastructure/supabase/repositories/template-review-repository.ts`
// and is the SOLE writer (service-role bypasses RLS — see migration 044).

import type { TemplateReview } from '../entities/template-review'
import type { ReviewStatus } from '../value-objects/review-status'

export interface TemplateReviewRepository {
  /**
   * Insert a freshly-submitted review row. Throws on partial-unique-index
   * conflict (an active row already exists for the same template name).
   */
  insert(review: TemplateReview): Promise<void>

  /**
   * Returns the active (pending OR approved) review for the given
   * (restaurantId, templateName), or null when none exists. Used by the
   * marketing send-time gate to decide whether to allow the send.
   */
  findActiveByName(args: {
    restaurantId: string
    templateName: string
  }): Promise<TemplateReview | null>

  /**
   * Persist a transitioned entity back to the row. The row is identified by
   * `id` so the unique index slot survives the status flip. Throws if no
   * row matches.
   */
  update(review: TemplateReview): Promise<void>

  /**
   * List reviews for a tenant, optionally filtered by status. Sorted by
   * `submitted_at DESC`. Used by the admin queue + tenant dashboards.
   */
  listForRestaurant(args: {
    restaurantId: string
    status?: ReviewStatus
  }): Promise<TemplateReview[]>

  /**
   * List reviews across ALL tenants for a given status. Used by the admin
   * pending-queue endpoint.
   */
  listByStatus(args: { status: ReviewStatus }): Promise<TemplateReview[]>

  /**
   * Look up a review by id. Used by the admin decision endpoint.
   */
  findById(id: string): Promise<TemplateReview | null>
}

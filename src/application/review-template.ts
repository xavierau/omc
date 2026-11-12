// WAQ-011: platform-admin action — approve / reject / request_changes a
// pending template_review_queue row.
//
// Authorization is enforced natively at this layer (defense in depth):
// the route layer SHOULD also call `assertPlatformAdmin`, but we double-
// check here so a future route author who forgets the route-layer guard
// cannot let a tenant user approve their own template (mirrors WAQ-009's
// `clearTenantAutoQualityFlags`).
//
// Audit logging fires only AFTER the repo write succeeds — a failed
// update must not leave a misleading audit trail. The domain entity
// enforces "only from pending" + "notes required to reject /
// request_changes"; we don't redo those checks here.

import {
  findTemplateReviewById,
  updateTemplateReview,
} from '@/infrastructure/supabase/repositories/template-review-repository'
import { logAdminAction } from '@/infrastructure/supabase/audit-logger'
import type { TemplateReview } from '@/domain/entities/template-review'
import { ForbiddenError } from './forbidden-error'

const PLATFORM_ADMIN_ROLE = 'platform_admin'

export type ReviewAction = 'approve' | 'reject' | 'request_changes'

export interface ReviewTemplateArgs {
  reviewId: string
  action: ReviewAction
  notes?: string
  actor: { userId: string; role: string }
}

export async function reviewTemplate(args: ReviewTemplateArgs): Promise<void> {
  validate(args)
  assertActorIsPlatformAdmin(args.actor)
  const review = await findTemplateReviewById(args.reviewId)
  if (!review) {
    throw new Error(`reviewTemplate: review ${args.reviewId} not found`)
  }
  const next = applyDecision(review, args)
  await updateTemplateReview(next)
  audit(review, args)
}

function audit(review: TemplateReview, args: ReviewTemplateArgs): void {
  logAdminAction({
    userId: args.actor.userId,
    action: `template_review.${args.action}`,
    resourceType: 'template_review_queue',
    resourceId: review.snapshot.id,
    details: {
      restaurantId: review.snapshot.restaurantId,
      templateName: review.snapshot.templateName,
      actorRole: args.actor.role,
      hasNotes: typeof args.notes === 'string' && args.notes.trim().length > 0,
    },
  })
}

function applyDecision(
  review: TemplateReview,
  args: ReviewTemplateArgs
): TemplateReview {
  switch (args.action) {
    case 'approve':
      return review.approve(args.actor.userId, args.notes ?? undefined)
    case 'reject':
      return review.reject(args.actor.userId, args.notes ?? '')
    case 'request_changes':
      return review.requestChanges(args.actor.userId, args.notes ?? '')
  }
}

function validate(args: ReviewTemplateArgs): void {
  if (!args.reviewId || !args.reviewId.trim()) {
    throw new Error('reviewTemplate: reviewId is required')
  }
  if (!args.actor?.userId || !args.actor.userId.trim()) {
    throw new Error('reviewTemplate: actor.userId is required')
  }
}

function assertActorIsPlatformAdmin(actor: { role: string }): void {
  if (actor.role !== PLATFORM_ADMIN_ROLE) {
    throw new ForbiddenError(
      `reviewTemplate: requires ${PLATFORM_ADMIN_ROLE}, got '${actor.role || 'none'}'`
    )
  }
}

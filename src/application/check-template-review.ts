// WAQ-011: marketing-template send-time gate.
//
// Trusted tenants (`isTenantTrusted` -> true) bypass this check entirely
// — the queue exists ONLY to gate untrusted senders. For untrusted
// senders we require an active row with `status='approved'` for the
// (restaurantId, templateName) pair. PENDING is not enough: the
// platform admin must have made a decision.
//
// The result mirrors the `{ allowed, reason }` shape used elsewhere
// (see check-marketing-cooldown / check-marketing-consent) so callers
// can compose this with other gates uniformly. A `trustReason` is
// surfaced on denial so ops can distinguish "new tenant" from
// "auto-paused recovery" in alerts.

import { isTenantTrusted, type TrustReason } from './check-tenant-trust'
import { findActiveTemplateReviewByName } from '@/infrastructure/supabase/repositories/template-review-repository'

export interface CheckTemplateReviewArgs {
  restaurantId: string
  templateName: string
}

export interface TemplateReviewCheckResult {
  allowed: boolean
  reason?: 'template_review_required'
  trustReason?: TrustReason
}

const ALLOWED: TemplateReviewCheckResult = { allowed: true }

export async function checkTemplateReview(
  args: CheckTemplateReviewArgs
): Promise<TemplateReviewCheckResult> {
  validate(args)
  const trust = await isTenantTrusted({ restaurantId: args.restaurantId })
  if (trust.trusted) return ALLOWED

  const active = await findActiveTemplateReviewByName({
    restaurantId: args.restaurantId,
    templateName: args.templateName,
  })
  if (active && active.snapshot.status === 'approved') return ALLOWED

  return {
    allowed: false,
    reason: 'template_review_required',
    trustReason: trust.reason,
  }
}

function validate(args: CheckTemplateReviewArgs): void {
  if (!args.restaurantId || !args.restaurantId.trim()) {
    throw new Error('checkTemplateReview: restaurantId is required')
  }
  if (!args.templateName || !args.templateName.trim()) {
    throw new Error('checkTemplateReview: templateName is required')
  }
}

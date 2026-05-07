import { parseImageUrl } from '../parse-image-url'
import type { UpdateCampaignParams } from '@/infrastructure/supabase/repositories/campaign-repository'
import type { Campaign } from '@/domain/entities/campaign'

const ALLOWED = new Set([
  'name',
  'type',
  'template',
  'templateEn',
  'templateZhHk',
  'imageUrlEn',
  'imageUrlZhHk',
  'couponConfig',
  'schedule',
  'scheduledAt',
  'whatsappTemplateId',
  'status',
  'targetAudience',
])

// P0 fix (review finding 2): a tenant-manager could resume an auto-paused
// reconfirmation campaign by PATCHing { status: 'active' }, bypassing the
// platform-admin-only resume gate (locked decision Q-H2). The resume path is
// `/api/admin/tenants/[id]/campaigns/[campaignId]/reconfirmation/resume` and
// is restricted to platform-admins. To prevent the bypass we strip `status`
// from any PATCH against a reconfirmation-mode campaign — there is no
// tenant-manager surface that legitimately needs to flip a reconfirmation
// campaign's status (no archive workflow yet either: 'archived' is not in
// the current Campaign.status union, so we simply reject any status change).
export class ReconfirmationResumeForbiddenError extends Error {
  readonly statusCode = 403
  readonly reason = 'RECONFIRMATION_RESUME_REQUIRES_PLATFORM_ADMIN'
  constructor() {
    super('Reconfirmation campaigns can only be resumed by a platform admin')
  }
}

export function pickAllowed(
  body: Record<string, unknown>,
  existing?: Campaign
): UpdateCampaignParams {
  const changes: Record<string, unknown> = {}
  for (const key of ALLOWED) {
    if (body[key] !== undefined) changes[key] = body[key]
  }
  assertReconfirmationStatusAllowed(changes, existing)
  return changes as UpdateCampaignParams
}

function assertReconfirmationStatusAllowed(
  changes: Record<string, unknown>,
  existing?: Campaign
): void {
  if (!existing) return
  if (existing.mode !== 'reconfirmation') return
  if (changes.status === undefined) return
  // Future-proof: if/when an 'archived' state is added to the Campaign union,
  // tenants legitimately need to archive their own reconfirmation campaigns
  // (end-of-life). Accept that here so the gate doesn't need to relax later.
  if (changes.status === 'archived') return
  throw new ReconfirmationResumeForbiddenError()
}

/**
 * Welcome-only image scope guard.
 *
 * - If the effective next type is NOT 'welcome', coerce both image URLs to
 *   null so a direct API caller can't leave stale welcome images attached
 *   to a winback/promo row.
 * - If the effective next type IS 'welcome', validate any non-null image
 *   URLs via `parseImageUrl` (tenant scope + https + host).
 *
 * Effective type = patch's `type` if present, else the existing row's type.
 */
export function applyImageScopeGuard(
  changes: UpdateCampaignParams,
  existing: Campaign,
  restaurantId: string
): void {
  const effectiveType = changes.type ?? existing.type
  if (effectiveType !== 'welcome') {
    changes.imageUrlEn = null
    changes.imageUrlZhHk = null
    return
  }
  if (changes.imageUrlEn !== undefined && changes.imageUrlEn !== null) {
    changes.imageUrlEn = parseImageUrl(changes.imageUrlEn, restaurantId)
  }
  if (changes.imageUrlZhHk !== undefined && changes.imageUrlZhHk !== null) {
    changes.imageUrlZhHk = parseImageUrl(changes.imageUrlZhHk, restaurantId)
  }
}

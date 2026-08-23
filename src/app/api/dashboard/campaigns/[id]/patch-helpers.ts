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

export function pickAllowed(body: Record<string, unknown>): UpdateCampaignParams {
  const changes: Record<string, unknown> = {}
  for (const key of ALLOWED) {
    if (body[key] !== undefined) changes[key] = body[key]
  }
  return changes as UpdateCampaignParams
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
/**
 * Issue #102 review round 2, item 4: `failure_reason` is non-null ONLY
 * when status='failed' (the entity invariant — see campaign.ts). A PATCH
 * that moves status AWAY from 'failed' — most commonly an admin reviving a
 * stuck campaign back to 'active' — must clear the stale reason, or a UI
 * reading failureReason after a successful revival would still show the
 * old failure.
 *
 * Deliberately NOT clearing/advancing `scheduledAt` on revival: a campaign
 * revived with a scheduled_at still in the past becomes immediately due on
 * the next cron tick — the same semantics as reactivating any other
 * paused campaign with a stale scheduled_at. That is intentional: an admin
 * reviving a stuck send expects it to go out, not silently wait for a new
 * schedule.
 */
export function applyFailureReasonRevivalGuard(
  changes: UpdateCampaignParams
): void {
  if (changes.status !== undefined && changes.status !== 'failed') {
    changes.failureReason = null
  }
}

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

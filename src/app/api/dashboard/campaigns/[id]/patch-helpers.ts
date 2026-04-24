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

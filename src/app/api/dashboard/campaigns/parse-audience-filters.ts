import { CampaignBodyError } from './parse-create-body-errors'
import {
  parseLapsedDays,
  parseSkipContactQuality,
  SKIP_CONTACT_QUALITY_LEVELS,
  type CampaignAudienceDefaults,
  type SkipContactQuality,
} from '@/domain/value-objects/audience-filters'

/**
 * CAMP-016: the audience filter snapshot a campaign is created (or edited)
 * with, and the filters the recipient count is computed with. One parser for
 * both, so the count the form shows uses exactly the values the campaign
 * stores (count/send parity). The client's pre-fill is a convenience, not
 * trust: every value is re-validated here (R4).
 *
 *  - welcome: no filters (sent on join, one member at a time).
 *  - skip omitted → the saved value on an edit, else the tenant default.
 *  - lapsed omitted → the saved value on an edit; null (or nothing saved) →
 *    the tenant's lapsed days for a win-back (a win-back always has a lapsed
 *    filter), no filter otherwise.
 */
export interface AudienceSnapshot {
  audienceSkipQuality: SkipContactQuality
  audienceLapsedDays: number | null
}

/** The snapshot an edited campaign was saved with; fills fields the PATCH omits. */
export type SavedAudienceSnapshot = Partial<AudienceSnapshot>

export function parseAudienceSnapshot(
  body: Record<string, unknown>,
  type: unknown,
  defaults: CampaignAudienceDefaults,
  saved: SavedAudienceSnapshot = {}
): AudienceSnapshot {
  if (type === 'welcome') return { audienceSkipQuality: 'off', audienceLapsedDays: null }
  const skip = body.audienceSkipQuality === undefined ? saved.audienceSkipQuality : body.audienceSkipQuality
  const lapsed = body.audienceLapsedDays === undefined ? saved.audienceLapsedDays : body.audienceLapsedDays
  return {
    audienceSkipQuality: parseSkip(skip, defaults),
    audienceLapsedDays: parseLapsed(lapsed, type, defaults),
  }
}

/**
 * True when a PATCH must re-snapshot the filters: it sends one of them, or it
 * turns the campaign into a win-back (which always carries lapsed days, so
 * the pre-086 legacy win-back read never applies to an edited campaign).
 */
export function touchesAudienceFilters(body: Record<string, unknown>): boolean {
  return (
    body.audienceSkipQuality !== undefined ||
    body.audienceLapsedDays !== undefined ||
    body.type === 'winback'
  )
}

function parseSkip(value: unknown, defaults: CampaignAudienceDefaults): SkipContactQuality {
  if (value === undefined) return defaults.skipContactQuality
  const level = parseSkipContactQuality(value)
  if (!level) {
    throw new CampaignBodyError(
      400,
      `audienceSkipQuality must be one of: ${SKIP_CONTACT_QUALITY_LEVELS.join(', ')}`
    )
  }
  return level
}

function parseLapsed(value: unknown, type: unknown, defaults: CampaignAudienceDefaults): number | null {
  if (value === undefined || value === null) {
    return type === 'winback' ? defaults.lapsedAfterDays : null
  }
  const days = parseLapsedDays(value)
  if (days === null) {
    throw new CampaignBodyError(400, 'audienceLapsedDays must be an integer from 1 to 365')
  }
  return days
}

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
 *  - skip omitted → the tenant default; lapsed omitted or null → the tenant's
 *    lapsed days for a win-back (a win-back always has a lapsed filter), no
 *    filter otherwise.
 */
export interface AudienceSnapshot {
  audienceSkipQuality: SkipContactQuality
  audienceLapsedDays: number | null
}

export function parseAudienceSnapshot(
  body: Record<string, unknown>,
  type: unknown,
  defaults: CampaignAudienceDefaults
): AudienceSnapshot {
  if (type === 'welcome') return { audienceSkipQuality: 'off', audienceLapsedDays: null }
  return {
    audienceSkipQuality: parseSkip(body.audienceSkipQuality, defaults),
    audienceLapsedDays: parseLapsed(body.audienceLapsedDays, type, defaults),
  }
}

/** True when a PATCH body touches the audience filters. */
export function touchesAudienceFilters(body: Record<string, unknown>): boolean {
  return body.audienceSkipQuality !== undefined || body.audienceLapsedDays !== undefined
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

// CAMP-016: campaign audience filters (skip low-quality contacts, lapsed
// customers). Tenant defaults live in tenant_campaign_settings; each campaign
// snapshots its own values at create (migration 086).
import type { ContactQualityRating } from './contact-quality'

export const SKIP_CONTACT_QUALITY_LEVELS = ['off', 'red', 'red_yellow'] as const
export type SkipContactQuality = (typeof SKIP_CONTACT_QUALITY_LEVELS)[number]

export const LAPSED_DAYS_MIN = 1
export const LAPSED_DAYS_MAX = 365

export interface CampaignAudienceDefaults {
  skipContactQuality: SkipContactQuality
  lapsedAfterDays: number
}

/** The column defaults of migration 086; used only when a row is missing. */
export const DEFAULT_AUDIENCE_DEFAULTS: CampaignAudienceDefaults = {
  skipContactQuality: 'red',
  lapsedAfterDays: 30,
}

export function parseSkipContactQuality(value: unknown): SkipContactQuality | null {
  return SKIP_CONTACT_QUALITY_LEVELS.includes(value as SkipContactQuality)
    ? (value as SkipContactQuality)
    : null
}

/** An integer day count in 1..365, else null. */
export function parseLapsedDays(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  return value >= LAPSED_DAYS_MIN && value <= LAPSED_DAYS_MAX ? value : null
}

/** Whether a contact of this rating is left out at this skip level. No data is never skipped. */
export function isSkippedRating(rating: ContactQualityRating, level: SkipContactQuality): boolean {
  if (level === 'red') return rating === 'red'
  if (level === 'red_yellow') return rating === 'red' || rating === 'yellow'
  return false
}

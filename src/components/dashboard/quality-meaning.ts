// CAMP-016: the four contact-quality colours and their one-line meanings,
// shared by Settings → Campaigns, the campaign form's colour key and the
// members-table badge tooltip (D4). Percentages come from the thresholds in
// contact-quality.ts, never from copy.
import {
  CONTACT_QUALITY_THRESHOLDS,
  CONTACT_QUALITY_WINDOW_DAYS,
  type ContactQualityRating,
} from '@/domain/value-objects/contact-quality'

export const QUALITY_RATINGS: readonly ContactQualityRating[] = ['green', 'yellow', 'red', 'unknown']

export interface QualityMeaningValues {
  green: number
  /** Yellow runs from here up to UNDER green (copy says "to under", so 89.x% is never in a gap). */
  yellow: number
  days: number
}

export function qualityMeaningValues(): QualityMeaningValues {
  const green = Math.round(CONTACT_QUALITY_THRESHOLDS.green * 100)
  const yellow = Math.round(CONTACT_QUALITY_THRESHOLDS.yellow * 100)
  return { green, yellow, days: CONTACT_QUALITY_WINDOW_DAYS }
}

/** Solid shades for dots and the stacked bar (the badge uses the 15% tints). */
export const QUALITY_SOLID_CLASS: Record<ContactQualityRating, string> = {
  green: 'bg-green-600',
  yellow: 'bg-yellow-500',
  red: 'bg-red-600',
  unknown: 'bg-muted-foreground/30',
}

/** Test-id suffix per the UX spec (`nodata`, not `unknown`). */
export const QUALITY_TESTID: Record<ContactQualityRating, string> = {
  green: 'green',
  yellow: 'yellow',
  red: 'red',
  unknown: 'nodata',
}

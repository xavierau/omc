// CAMP-016: Settings → Campaigns form state, kept pure so it is testable
// without a DOM.
import { parseLapsedDays, type SkipContactQuality } from '@/domain/value-objects/audience-filters'
import type { MemberQualityDistribution } from '@/hooks/use-member-quality-distribution'

export type SkipLevel = Exclude<SkipContactQuality, 'off'>

export interface CampaignSettingsForm {
  skipEnabled: boolean
  /** Kept while the toggle is off, so switching back on restores it. */
  skipLevel: SkipLevel
  lapsedDays: string
}

export function formFromSettings(s: { skipContactQuality: SkipContactQuality; lapsedAfterDays: number }): CampaignSettingsForm {
  return {
    skipEnabled: s.skipContactQuality !== 'off',
    skipLevel: s.skipContactQuality === 'red_yellow' ? 'red_yellow' : 'red',
    lapsedDays: String(s.lapsedAfterDays),
  }
}

/** The lapsed-days input as a valid 1..365 integer, else null. */
export function lapsedDaysValue(raw: string): number | null {
  return /^\d+$/.test(raw.trim()) ? parseLapsedDays(Number(raw.trim())) : null
}

export function skipValue(form: Pick<CampaignSettingsForm, 'skipEnabled' | 'skipLevel'>): SkipContactQuality {
  return form.skipEnabled ? form.skipLevel : 'off'
}

/** The PUT body, or null while the form is invalid. */
export function formToBody(form: CampaignSettingsForm) {
  const lapsedAfterDays = lapsedDaysValue(form.lapsedDays)
  return lapsedAfterDays === null ? null : { skipContactQuality: skipValue(form), lapsedAfterDays }
}

export function isDirty(form: CampaignSettingsForm, saved: CampaignSettingsForm): boolean {
  return skipValue(form) !== skipValue(saved) || form.lapsedDays.trim() !== saved.lapsedDays.trim()
}

/** How many active members today's distribution would skip at this level. */
export function skippedToday(dist: MemberQualityDistribution, level: SkipLevel): number {
  return level === 'red_yellow' ? dist.red + dist.yellow : dist.red
}

// CAMP-016: the campaign form's audience filters (lapsed customers, skip
// low-quality contacts). Pure, so the request body the form sends to create
// and to the recipient count is built by one function (count/send parity).
import { parseLapsedDays, type SkipContactQuality } from '@/domain/value-objects/audience-filters'
import type { CampaignAudienceSettings } from '@/hooks/use-campaign-audience-settings'
import type { Campaign } from '@/domain/entities/campaign'

export interface AudienceFilterState {
  lapsedEnabled: boolean
  lapsedDays: string
  skipEnabled: boolean
  /** The skip level a campaign uses: the Settings default (create) or its snapshot (edit). */
  skipLevel: Exclude<SkipContactQuality, 'off'>
}

/** A win-back always targets lapsed customers; the toggle is locked on for it. */
export function lapsedLocked(type: string): boolean {
  return type === 'winback'
}

export function filtersFromDefaults(d: Pick<CampaignAudienceSettings, 'skipContactQuality' | 'lapsedAfterDays'>, type: string): AudienceFilterState {
  return {
    lapsedEnabled: lapsedLocked(type),
    lapsedDays: String(d.lapsedAfterDays),
    skipEnabled: d.skipContactQuality !== 'off',
    skipLevel: d.skipContactQuality === 'red_yellow' ? 'red_yellow' : 'red',
  }
}

export function filtersFromCampaign(c: Campaign): AudienceFilterState {
  const legacyDays = (c.schedule as { inactiveDays?: unknown } | null)?.inactiveDays
  const days = c.audienceLapsedDays ?? (typeof legacyDays === 'number' ? legacyDays : 30)
  return {
    lapsedEnabled: c.audienceLapsedDays != null || lapsedLocked(c.type),
    lapsedDays: String(days),
    skipEnabled: (c.audienceSkipQuality ?? 'off') !== 'off',
    skipLevel: c.audienceSkipQuality === 'red_yellow' ? 'red_yellow' : 'red',
  }
}

export function skipQuality(f: Pick<AudienceFilterState, 'skipEnabled' | 'skipLevel'>): SkipContactQuality {
  return f.skipEnabled ? f.skipLevel : 'off'
}

/** The lapsed days to send, null for no filter, undefined while the input is invalid. */
export function lapsedDaysToSend(f: Pick<AudienceFilterState, 'lapsedEnabled' | 'lapsedDays'>): number | null | undefined {
  if (!f.lapsedEnabled) return null
  const raw = f.lapsedDays.trim()
  return /^\d+$/.test(raw) ? (parseLapsedDays(Number(raw)) ?? undefined) : undefined
}

export function audienceFilterFields(f: AudienceFilterState) {
  return { audienceSkipQuality: skipQuality(f), audienceLapsedDays: lapsedDaysToSend(f) }
}

interface CountForm extends AudienceFilterState {
  type: string
  targetAudience: 'all' | 'selected' | 'tag'
  tagIds: string[]
  memberIds: string[]
}

/** The recipient-count request for this form, or null when there is nothing to count yet. */
export function audienceCountBody(form: CountForm): Record<string, unknown> | null {
  if (form.type === 'welcome') return null
  if (form.targetAudience === 'tag' && form.tagIds.length === 0) return null
  if (form.targetAudience === 'selected' && form.memberIds.length === 0) return null
  const filters = audienceFilterFields(form)
  if (filters.audienceLapsedDays === undefined) return null
  return {
    type: form.type,
    targetAudience: form.targetAudience,
    ...(form.targetAudience === 'tag' ? { tagIds: form.tagIds } : {}),
    ...(form.targetAudience === 'selected' ? { memberIds: form.memberIds } : {}),
    ...filters,
  }
}

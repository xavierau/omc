import type { ContactQuality } from '@/domain/value-objects/contact-quality'
import type { MemberQualityEvidence } from '@/infrastructure/supabase/repositories/member-quality-evidence'

/**
 * Client-side helper that loads a member's detail from the dashboard API.
 * Isolated from the panel component so vitest (which is configured for
 * `.test.ts` only) can cover the response handling without RTL.
 *
 * A non-ok response resolves to null — a 404 body is `{ error: string }`,
 * which is truthy and, if handed to the panel as a "member", crashes the
 * receipts renderer (#111 review finding). Null renders the panel's
 * not-found state instead.
 */
export async function fetchMemberDetail<T>(memberId: string): Promise<T | null> {
  const res = await fetch(`/api/dashboard/members?id=${memberId}`)
  if (!res.ok) return null
  return (await res.json()) as T
}

export interface QualityVerdict {
  key: string
  values: Record<string, string | number>
}

const pct = (fraction: number) => Math.round(fraction * 100)

/** One verdict sentence per reason; window and thresholds come from the payload. */
export function buildQualityVerdict(e: MemberQualityEvidence, formatDate: (iso: string) => string): QualityVerdict {
  const { quality, windowDays: days, thresholds, counts } = e
  const rate = {
    delivered: counts.delivered,
    total: quality.sampleSize,
    rate: pct(quality.deliveryRate ?? 0),
    days,
  }
  switch (quality.reason) {
    case 'unreachable':
      return { key: 'qualityVerdictUnreachable', values: { date: e.unreachableAt ? formatDate(e.unreachableAt) : '—' } }
    case 'no_data':
      return { key: 'qualityVerdictNoData', values: { days } }
    case 'meets_green':
      return { key: 'qualityVerdictGreen', values: { ...rate, green: pct(thresholds.green) } }
    case 'meets_yellow':
      return { key: 'qualityVerdictYellow', values: { ...rate, green: pct(thresholds.green) } }
    case 'below_yellow':
      return { key: 'qualityVerdictRed', values: { ...rate, yellow: pct(thresholds.yellow) } }
  }
}

export function isPmmThrottled(until: string | null, now: Date = new Date()): boolean {
  return until !== null && new Date(until).getTime() > now.getTime()
}

/** Tooltip copy per reason, so a Red never contradicts itself (unreachable has no rate to quote). */
export function buildQualityTooltip(q: ContactQuality, days: number): QualityVerdict {
  if (q.reason === 'unreachable') return { key: 'qualityUnreachableTooltip', values: {} }
  if (q.reason === 'no_data' || q.deliveryRate === null) return { key: 'qualityNoDataTooltip', values: { days } }
  return { key: 'qualityTooltip', values: { rate: pct(q.deliveryRate), count: q.sampleSize, days } }
}

/** After a refetch, the last page that still has rows (never below 1, never past the end). */
export function clampPage(page: number, totalPages: number): number {
  return totalPages >= 1 && page > totalPages ? totalPages : page
}

export function formatDate(d: string | null): string {
  if (!d) return '\u2014'
  return new Date(d).toLocaleDateString('en-HK', { month: 'short', day: 'numeric', year: 'numeric' })
}

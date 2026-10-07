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

export type QualityReason = 'unreachable' | 'no_data' | 'meets_green' | 'meets_yellow' | 'below_yellow'

export interface QualityEvidence {
  quality: {
    rating: 'green' | 'yellow' | 'red' | 'unknown'
    deliveryRate: number | null
    sampleSize: number
    reason: QualityReason
  }
  windowDays: number
  thresholds: { green: number; yellow: number }
  counts: { delivered: number; read: number; failed: number; pending: number }
  unreachableAt: string | null
  pmmThrottledUntil: string | null
  recentMessages: {
    id: string
    queuedAt: string
    status: string
    category: string
    templateName: string | null
    errorCode: string | null
    errorTitle: string | null
  }[]
}

export interface QualityVerdict {
  key: string
  values: Record<string, string | number>
}

const pct = (fraction: number) => Math.round(fraction * 100)

/** One verdict sentence per reason; window and thresholds come from the payload. */
export function buildQualityVerdict(e: QualityEvidence, formatDate: (iso: string) => string): QualityVerdict {
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

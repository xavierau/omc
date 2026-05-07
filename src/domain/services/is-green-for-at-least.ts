// WONB-008 Q-H: pure-function mirror of the `tenant_green_for_days` SQL
// RPC. Same strict semantics — tenant is "Green for ≥ minDays" iff:
//   1. The most recent transition is GREEN, AND
//   2. Either there has never been a non-GREEN transition AND the earliest
//      GREEN is ≥ minDays old, OR the latest non-GREEN transition is
//      ≥ minDays old (any non-GREEN inside the window disqualifies).
//
// History order is normalised internally so callers can pass events in any
// order. The cutoff is computed against an explicit `now` so callers can
// inject a deterministic clock in tests.

import type { QualityStateEvent } from '@/domain/entities/quality-state-event'

const MS_PER_DAY = 86_400_000

export function isGreenForAtLeast(
  events: QualityStateEvent[],
  minDays: number,
  now: Date = new Date()
): boolean {
  if (events.length === 0) return false
  const sorted = sortAscending(events)
  const current = sorted[sorted.length - 1]
  if (current.snapshot.qualityRating !== 'GREEN') return false
  const cutoff = now.getTime() - minDays * MS_PER_DAY
  return greenStreakReachesCutoff(sorted, cutoff)
}

// True when either the latest non-GREEN is ≤ cutoff, or no non-GREEN exists
// and the earliest GREEN is ≤ cutoff. Cutoff is the millisecond floor of the
// `now − minDays` window; "≤ cutoff" means "≥ minDays old".
function greenStreakReachesCutoff(
  ascending: QualityStateEvent[],
  cutoff: number
): boolean {
  const latestNonGreen = lastTimestamp(ascending, (r) => r !== 'GREEN')
  if (latestNonGreen !== null) return latestNonGreen <= cutoff
  const earliestGreen = firstTimestamp(ascending, (r) => r === 'GREEN')
  return earliestGreen !== null && earliestGreen <= cutoff
}

function lastTimestamp(
  ascending: QualityStateEvent[],
  match: (rating: string) => boolean
): number | null {
  for (let i = ascending.length - 1; i >= 0; i--) {
    const e = ascending[i]
    if (match(e.snapshot.qualityRating)) {
      return Date.parse(e.snapshot.transitionedAt)
    }
  }
  return null
}

function firstTimestamp(
  ascending: QualityStateEvent[],
  match: (rating: string) => boolean
): number | null {
  for (const e of ascending) {
    if (match(e.snapshot.qualityRating)) {
      return Date.parse(e.snapshot.transitionedAt)
    }
  }
  return null
}

function sortAscending(events: QualityStateEvent[]): QualityStateEvent[] {
  return [...events].sort(
    (a, b) =>
      Date.parse(a.snapshot.transitionedAt) -
      Date.parse(b.snapshot.transitionedAt)
  )
}

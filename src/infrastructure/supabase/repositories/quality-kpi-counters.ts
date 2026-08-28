// WAQ-012 helper module: rate derivation + cutoff math. Pure logic — no
// Supabase dependency, easy to unit-test in isolation.
//
// Aggregation now happens server-side in the RPCs from migration 045
// (review fix r1, Fix 1), so the previous client-side tally helpers are
// gone. This module is intentionally thin — it owns the rate semantics
// and the window-cutoff arithmetic.

export interface QualityKpis {
  totalSends: number
  delivered: number
  read: number
  failed: number
  optedOut: number
  deliveryRate: number
  readRate: number
  errorRate: number
  optOutRate: number
}

export interface Counters {
  totalSends: number
  delivered: number
  read: number
  failed: number
  optedOut: number
}

// rate() returns NaN — not 0 — when the denominator is zero so callers can
// distinguish "no sends, undefined rate" from "many sends, perfect rate"
// (review fix r1, Fix 2). The UI's formatPct() treats NaN as '—' and a
// real 0 as '0.0%'.
export function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? NaN : numerator / denominator
}

export function toKpisFromCounters(c: Counters): QualityKpis {
  return {
    totalSends: c.totalSends,
    delivered: c.delivered,
    read: c.read,
    failed: c.failed,
    optedOut: c.optedOut,
    deliveryRate: rate(c.delivered, c.totalSends),
    readRate: rate(c.read, c.delivered),
    errorRate: rate(c.failed, c.totalSends),
    optOutRate: rate(c.optedOut, c.totalSends),
  }
}

export function cutoffIso(now: Date | undefined, windowDays: number): string {
  const ref = now ?? new Date()
  return new Date(ref.getTime() - windowDays * 24 * 3600_000).toISOString()
}

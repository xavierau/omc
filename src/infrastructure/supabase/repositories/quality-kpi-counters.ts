// WAQ-012 helper module: counter accumulation + rate derivation. Extracted
// from `quality-kpi-queries.ts` so the main file stays under the size limit.
// Pure logic — no Supabase dependency, easy to unit-test in isolation.

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

const STATUS_DELIVERED = ['delivered', 'read'] as const

export function emptyCounters(): Counters {
  return { totalSends: 0, delivered: 0, read: 0, failed: 0, optedOut: 0 }
}

export function tally(c: Counters, status: string): void {
  c.totalSends += 1
  if (STATUS_DELIVERED.includes(status as (typeof STATUS_DELIVERED)[number])) {
    c.delivered += 1
  }
  if (status === 'read') c.read += 1
  if (status === 'failed') c.failed += 1
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator
}

export function toKpis(c: Counters): QualityKpis {
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

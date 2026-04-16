import type { ReferrerCommissionRow } from './referrer-commission-mapper'

export interface ReferrerEarnings {
  total: number
  pending: number
  totalBroadcast: number
  totalRedemption: number
}

export type EarningsRow = Pick<
  ReferrerCommissionRow,
  | 'status'
  | 'total_commission'
  | 'broadcast_commission'
  | 'redemption_commission'
>

export type EarningsRowWithId = EarningsRow & { referrer_id: string }

export function aggregateEarnings(rows: EarningsRow[]): ReferrerEarnings {
  const totals = rows.reduce(addRow, emptyTotals())
  return {
    total: round2(totals.total),
    pending: round2(totals.pending),
    totalBroadcast: round2(totals.totalBroadcast),
    totalRedemption: round2(totals.totalRedemption),
  }
}

export function groupEarningsByReferrer(
  rows: EarningsRowWithId[]
): Map<string, ReferrerEarnings> {
  const bucket = new Map<string, EarningsRow[]>()
  for (const row of rows) {
    const list = bucket.get(row.referrer_id) ?? []
    list.push(row)
    bucket.set(row.referrer_id, list)
  }
  const result = new Map<string, ReferrerEarnings>()
  for (const [id, list] of bucket) {
    result.set(id, aggregateEarnings(list))
  }
  return result
}

function addRow(acc: ReferrerEarnings, r: EarningsRow): ReferrerEarnings {
  const total = Number(r.total_commission)
  acc.total += total
  if (r.status === 'pending') acc.pending += total
  acc.totalBroadcast += Number(r.broadcast_commission)
  acc.totalRedemption += Number(r.redemption_commission)
  return acc
}

function emptyTotals(): ReferrerEarnings {
  return { total: 0, pending: 0, totalBroadcast: 0, totalRedemption: 0 }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

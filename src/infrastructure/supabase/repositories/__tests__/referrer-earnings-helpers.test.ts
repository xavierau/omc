import { describe, it, expect } from 'vitest'
import {
  aggregateEarnings,
  groupEarningsByReferrer,
  type EarningsRow,
  type EarningsRowWithId,
} from '../referrer-earnings-helpers'

function row(overrides: Partial<EarningsRow> = {}): EarningsRow {
  return {
    status: 'pending',
    total_commission: 0,
    broadcast_commission: 0,
    redemption_commission: 0,
    ...overrides,
  }
}

describe('aggregateEarnings', () => {
  it('returns zero totals for empty input', () => {
    expect(aggregateEarnings([])).toEqual({
      total: 0,
      pending: 0,
      totalBroadcast: 0,
      totalRedemption: 0,
    })
  })

  it('sums totals across rows and isolates pending', () => {
    const result = aggregateEarnings([
      row({
        status: 'pending',
        total_commission: 10,
        broadcast_commission: 7,
        redemption_commission: 3,
      }),
      row({
        status: 'paid',
        total_commission: 20,
        broadcast_commission: 12,
        redemption_commission: 8,
      }),
    ])

    expect(result).toEqual({
      total: 30,
      pending: 10,
      totalBroadcast: 19,
      totalRedemption: 11,
    })
  })

  it('rounds to two decimal places', () => {
    const result = aggregateEarnings([
      row({
        status: 'pending',
        total_commission: 0.11111,
        broadcast_commission: 0.06666,
        redemption_commission: 0.04444,
      }),
    ])

    expect(result.total).toBe(0.11)
    expect(result.totalBroadcast).toBe(0.07)
    expect(result.totalRedemption).toBe(0.04)
  })

  it('treats string numerics from Supabase as numbers', () => {
    const result = aggregateEarnings([
      row({
        status: 'pending',
        total_commission: '5' as unknown as number,
        broadcast_commission: '3' as unknown as number,
        redemption_commission: '2' as unknown as number,
      }),
    ])

    expect(result.total).toBe(5)
    expect(result.totalBroadcast).toBe(3)
    expect(result.totalRedemption).toBe(2)
  })

  it('computes total from split columns, ignoring divergent total_commission (belt-and-braces)', () => {
    // Migration 026 guarantees total_commission === broadcast + redemption via
    // a GENERATED column. This test asserts we do not trust total_commission
    // independently — if a (hypothetically) stale row has the wrong value,
    // total still reflects broadcast + redemption.
    const result = aggregateEarnings([
      row({
        status: 'pending',
        total_commission: 999, // divergent / stale / wrong
        broadcast_commission: 7,
        redemption_commission: 3,
      }),
      row({
        status: 'paid',
        total_commission: 12345, // divergent / stale / wrong
        broadcast_commission: 12,
        redemption_commission: 8,
      }),
    ])

    expect(result.total).toBe(30) // 7 + 3 + 12 + 8, NOT 999 + 12345
    expect(result.pending).toBe(10) // 7 + 3
    expect(result.totalBroadcast).toBe(19)
    expect(result.totalRedemption).toBe(11)
  })
})

describe('groupEarningsByReferrer', () => {
  it('returns an empty map for empty input', () => {
    expect(groupEarningsByReferrer([])).toEqual(new Map())
  })

  it('groups rows by referrer_id and aggregates each bucket', () => {
    const rows: EarningsRowWithId[] = [
      {
        referrer_id: 'ref-1',
        status: 'pending',
        total_commission: 10,
        broadcast_commission: 6,
        redemption_commission: 4,
      },
      {
        referrer_id: 'ref-1',
        status: 'paid',
        total_commission: 5,
        broadcast_commission: 3,
        redemption_commission: 2,
      },
      {
        referrer_id: 'ref-2',
        status: 'pending',
        total_commission: 20,
        broadcast_commission: 20,
        redemption_commission: 0,
      },
    ]

    const result = groupEarningsByReferrer(rows)

    expect(result.get('ref-1')).toEqual({
      total: 15,
      pending: 10,
      totalBroadcast: 9,
      totalRedemption: 6,
    })
    expect(result.get('ref-2')).toEqual({
      total: 20,
      pending: 20,
      totalBroadcast: 20,
      totalRedemption: 0,
    })
  })
})

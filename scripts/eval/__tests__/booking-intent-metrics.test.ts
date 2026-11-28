// BOOK-001 W2-10 (R20): eval metrics and CSV parsing.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { bookingMetrics, confusion, formatReport, parseCsv, parseLabelledCsv, type Prediction } from '../booking-intent-metrics'

const ok = (label: 'booking' | 'loyalty' | 'talk_to_staff' | 'other', confidence: number) =>
  ({ ok: true, label, confidence }) as const

describe('parseCsv / parseLabelledCsv', () => {
  it('handles quotes, commas, doubled quotes and CRLF', () => {
    expect(parseCsv('a,b\r\n"x, ""y""",z\n')).toEqual([['a', 'b'], ['x, "y"', 'z']])
  })

  it('reads the committed synthetic fixture', () => {
    const csv = readFileSync(path.join(process.cwd(), 'scripts/eval/fixtures/booking-intent-synthetic.csv'), 'utf8')
    const rows = parseLabelledCsv(csv)
    expect(rows.length).toBeGreaterThanOrEqual(10)
    expect(rows.filter((r) => r.label === 'booking').length).toBeGreaterThanOrEqual(4)
  })

  it('rejects a wrong header or an unknown label', () => {
    expect(() => parseLabelledCsv('message,label\nx,booking')).toThrow(/header/)
    expect(() => parseLabelledCsv('text,label\nx,billing')).toThrow(/row 2/)
  })
})

describe('bookingMetrics', () => {
  const predictions: Prediction[] = [
    { gold: 'booking', result: ok('booking', 0.95) },
    { gold: 'booking', result: ok('booking', 0.65) },
    { gold: 'booking', result: { ok: false, reason: 'timeout' } },
    { gold: 'other', result: ok('booking', 0.75) },
    { gold: 'loyalty', result: ok('loyalty', 0.9) },
  ]

  it('counts booking ≥ threshold as positive', () => {
    expect(bookingMetrics(predictions, 0.7)).toMatchObject({ tp: 1, fp: 1, fn: 2, precision: 0.5, recall: 1 / 3 })
    expect(bookingMetrics(predictions, 0.6)).toMatchObject({ tp: 2, fp: 1, fn: 1 })
    expect(bookingMetrics(predictions, 0.9)).toMatchObject({ tp: 1, fp: 0, fn: 2, precision: 1 })
  })

  it('no positives → precision 0, f1 0 (no NaN)', () => {
    const m = bookingMetrics([{ gold: 'other', result: ok('other', 0.9) }], 0.7)
    expect([m.precision, m.recall, m.f1]).toEqual([0, 0, 0])
  })

  it('confusion counts raw predicted labels, errors in their own column', () => {
    const table = confusion(predictions)
    expect(table.booking).toMatchObject({ booking: 2, error: 1 })
    expect(table.other.booking).toBe(1)
    expect(table.loyalty.loyalty).toBe(1)
  })

  it('the report prints numbers only, never the texts', () => {
    const report = formatReport(predictions)
    expect(report).toContain('threshold')
    expect(report.split('\n').filter((l) => /^\s+0\.\d/.test(l))).toHaveLength(5)
  })
})

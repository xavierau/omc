import { describe, it, expect } from 'vitest'
import {
  MAX_ROWS,
  classifyParseResult,
} from '@/components/dashboard/import-wizard/step-upload-csv-helpers'
import type { ParseCsvResult } from '@/components/dashboard/import-wizard/parse-csv'

function result(overrides: Partial<ParseCsvResult>): ParseCsvResult {
  return { phoneHeaderFound: true, rows: [], rejected: [], ...overrides }
}

describe('classifyParseResult', () => {
  it('T-A4.1 reports empty when no phone header was found', () => {
    const outcome = classifyParseResult(result({ phoneHeaderFound: false }), MAX_ROWS)
    expect(outcome).toEqual({ kind: 'error', error: 'empty' })
  })

  it('T-A4.2 reports empty for a header-only file', () => {
    const outcome = classifyParseResult(result({ rows: [], rejected: [] }), MAX_ROWS)
    expect(outcome).toEqual({ kind: 'error', error: 'empty' })
  })

  it('T-A4.3 reports ok when every row was rejected (panel, not the empty error)', () => {
    const parsed = result({
      rows: [],
      rejected: [{ line: 2, reason: 'column_count_mismatch', expected: 4, actual: 5, phone: null }],
    })
    const outcome = classifyParseResult(parsed, MAX_ROWS)
    expect(outcome).toEqual({ kind: 'ok', result: parsed })
  })

  it('T-A4.4 caps on accepted rows only — rejected rows never count toward it', () => {
    const atLimit = result({ rows: Array(MAX_ROWS).fill(makeRow()) })
    expect(classifyParseResult(atLimit, MAX_ROWS).kind).toBe('ok')

    const overLimit = result({ rows: Array(MAX_ROWS + 1).fill(makeRow()) })
    expect(classifyParseResult(overLimit, MAX_ROWS)).toEqual({ kind: 'error', error: 'tooManyRows' })

    const rejectedDoesNotCount = result({
      rows: Array(MAX_ROWS).fill(makeRow()),
      rejected: Array(1000).fill({ line: 2, reason: 'column_count_mismatch', expected: 1, actual: 2, phone: null }),
    })
    expect(classifyParseResult(rejectedDoesNotCount, MAX_ROWS).kind).toBe('ok')
  })

  it('T-A4.5 MAX_ROWS is 50,000', () => {
    expect(MAX_ROWS).toBe(50_000)
  })
})

function makeRow() {
  return { phoneE164: '+85291234567', name: null, preferredLanguage: null, tags: [], ignoredTagCount: 0 }
}

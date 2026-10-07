import { describe, it, expect } from 'vitest'
import { computeCsvTagStats } from '@/components/dashboard/import-wizard/parse-csv-tag-stats'
import type { ParsedRow } from '@/components/dashboard/import-wizard/parse-csv'

function row(tags: string[], ignoredTagCount = 0): ParsedRow {
  return { phoneE164: '+85291234567', name: null, preferredLanguage: null, tags, ignoredTagCount }
}

describe('computeCsvTagStats', () => {
  it('returns 0/0 for rows with no tags at all', () => {
    expect(computeCsvTagStats([row([]), row([])])).toEqual({ distinctTags: 0, ignoredTagValues: 0 })
  })

  it('counts distinct tags across rows via tagKey, case-insensitively', () => {
    const rows = [row(['VIP']), row(['vip', 'Lunch'])]
    expect(computeCsvTagStats(rows).distinctTags).toBe(2)
  })

  it('sums ignoredTagCount across all rows', () => {
    const rows = [row(['vip'], 1), row(['lunch'], 2)]
    expect(computeCsvTagStats(rows).ignoredTagValues).toBe(3)
  })

  it('is independent — a row with only ignored values and no surviving tags still counts', () => {
    const rows = [row([], 1)]
    expect(computeCsvTagStats(rows)).toEqual({ distinctTags: 0, ignoredTagValues: 1 })
  })

  it('returns 0/0 for an empty row list', () => {
    expect(computeCsvTagStats([])).toEqual({ distinctTags: 0, ignoredTagValues: 0 })
  })
})

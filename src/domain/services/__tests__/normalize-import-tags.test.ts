import { describe, it, expect } from 'vitest'
import {
  normalizeImportTags,
  normalizeImportTagNames,
  tagKey,
  MAX_TAGS_PER_ROW,
} from '../normalize-import-tags'

describe('normalizeImportTags', () => {
  it('splits a semicolon-separated cell into trimmed names (T-B1.1)', () => {
    expect(normalizeImportTags('vip;lunch')).toEqual({
      names: ['vip', 'lunch'],
      ignored: 0,
    })
  })

  it('returns empty for an empty cell (T-B1.2)', () => {
    expect(normalizeImportTags('')).toEqual({ names: [], ignored: 0 })
  })

  it('returns empty for a cell of only separators (T-B1.3)', () => {
    expect(normalizeImportTags(';;')).toEqual({ names: [], ignored: 0 })
  })

  it('returns empty for a whitespace-only cell (T-B1.4)', () => {
    expect(normalizeImportTags('  ;  ')).toEqual({ names: [], ignored: 0 })
  })

  it('dedupes case-insensitively, first-seen casing wins (T-B1.5)', () => {
    expect(normalizeImportTags('VIP;vip')).toEqual({
      names: ['VIP'],
      ignored: 0,
    })
  })

  it('normalises each row independently; tagKey unifies casing across rows (T-B1.6)', () => {
    const row1 = normalizeImportTags('VIP')
    const row2 = normalizeImportTags('vip')
    expect(row1.names).toEqual(['VIP'])
    expect(row2.names).toEqual(['vip'])
    expect(tagKey(row1.names[0])).toBe(tagKey(row2.names[0]))
  })

  it('drops a name over 40 chars (counted); keeps exactly 40 (T-B1.7)', () => {
    const forty = 'a'.repeat(40)
    const fortyOne = 'a'.repeat(41)
    expect(normalizeImportTags(fortyOne)).toEqual({ names: [], ignored: 1 })
    expect(normalizeImportTags(forty)).toEqual({ names: [forty], ignored: 0 })
  })

  it('caps at MAX_TAGS_PER_ROW, counting the excess as ignored (T-B1.8)', () => {
    const twelve = Array.from({ length: 12 }, (_, i) => `tag${i}`).join(';')
    const result = normalizeImportTags(twelve)
    expect(result.names).toHaveLength(MAX_TAGS_PER_ROW)
    expect(result.ignored).toBe(2)
    expect(result.names).toEqual(
      Array.from({ length: 10 }, (_, i) => `tag${i}`)
    )
  })

  it('returns empty for null/undefined input', () => {
    expect(normalizeImportTags(null)).toEqual({ names: [], ignored: 0 })
    expect(normalizeImportTags(undefined)).toEqual({ names: [], ignored: 0 })
  })
})

describe('normalizeImportTagNames — re-normalise an already-split array (server never trusts the client)', () => {
  it('trims, dedupes case-insensitively and drops blanks (T-B1.12)', () => {
    expect(normalizeImportTagNames(['  VIP  ', 'vip', ''])).toEqual({
      names: ['VIP'],
      ignored: 0,
    })
  })

  it('returns empty for an empty array', () => {
    expect(normalizeImportTagNames([])).toEqual({ names: [], ignored: 0 })
  })

  it('applies the same 40-char and cap-of-10 rules as the cell parser', () => {
    const fortyOne = 'b'.repeat(41)
    expect(normalizeImportTagNames([fortyOne])).toEqual({
      names: [],
      ignored: 1,
    })
  })
})

describe('tagKey', () => {
  it('lowercases and trims', () => {
    expect(tagKey('  VIP  ')).toBe('vip')
  })
})

import { describe, it, expect } from 'vitest'
import { parseCsv } from '@/components/dashboard/import-wizard/parse-csv'

describe('parseCsv', () => {
  it('parses minimal phone-only header', () => {
    const text = 'phone\n+85291234567\n+85299999999'
    expect(parseCsv(text).rows).toEqual([
      { phoneE164: '+85291234567', name: null, preferredLanguage: null, tags: [], ignoredTagCount: 0 },
      { phoneE164: '+85299999999', name: null, preferredLanguage: null, tags: [], ignoredTagCount: 0 },
    ])
  })

  it('parses phone, name, preferred_language headers in any order', () => {
    const text = 'name,phone,preferred_language\nWong,+85291234567,zh_hk'
    expect(parseCsv(text).rows).toEqual([
      { phoneE164: '+85291234567', name: 'Wong', preferredLanguage: 'zh_hk', tags: [], ignoredTagCount: 0 },
    ])
  })

  it('skips empty rows', () => {
    const text = 'phone\n+85291234567\n\n+85299999999\n'
    expect(parseCsv(text).rows).toHaveLength(2)
  })

  it('returns empty array for header-only input', () => {
    expect(parseCsv('phone\n').rows).toEqual([])
  })

  it('trims whitespace from cells', () => {
    const text = 'phone, name\n  +85291234567 ,  Wong  '
    expect(parseCsv(text).rows).toEqual([
      { phoneE164: '+85291234567', name: 'Wong', preferredLanguage: null, tags: [], ignoredTagCount: 0 },
    ])
  })

  it('normalises preferred_language case', () => {
    const text = 'phone,preferred_language\n+85291234567,EN'
    expect(parseCsv(text).rows[0].preferredLanguage).toBe('en')
  })

  it('drops rows missing phone column', () => {
    const text = 'phone,name\n,Wong\n+85291234567,Tam'
    expect(parseCsv(text).rows).toEqual([
      { phoneE164: '+85291234567', name: 'Tam', preferredLanguage: null, tags: [], ignoredTagCount: 0 },
    ])
  })

  it('parses tags column split on ";", trimmed and deduped (T-B1.9/T-B1.1)', () => {
    const text = 'phone,tags\n+85291234567,vip; lunch ;VIP'
    expect(parseCsv(text).rows[0].tags).toEqual(['vip', 'lunch'])
  })

  it('accepts the singular "tag" header alias (T-B1.10)', () => {
    const text = 'phone,tag\n+85291234567,vip'
    expect(parseCsv(text).rows[0].tags).toEqual(['vip'])
  })

  it('defaults tags to [] when no tags header is present (T-B1.9)', () => {
    const text = 'phone,name\n+85291234567,Tam'
    expect(parseCsv(text).rows[0].tags).toEqual([])
  })

  it('carries the per-row ignored tag-value count (I-2)', () => {
    const overLong = 'x'.repeat(41)
    const rows = parseCsv(`phone,tags\n+85291234567,${overLong};vip\n`).rows
    expect(rows[0].tags).toEqual(['vip'])
    expect(rows[0].ignoredTagCount).toBe(1)
  })

  it('defaults ignoredTagCount to 0 when no tags header is present', () => {
    const text = 'phone,name\n+85291234567,Tam'
    expect(parseCsv(text).rows[0].ignoredTagCount).toBe(0)
  })
})

describe('parseCsv — column-count rejection (WONB-018 / #148)', () => {
  it('T-A2.1 parses the #148 row exactly when the comma-containing name is quoted', () => {
    const text = 'phone,name,preferred_language,tags\n+85290001234,"Chan, Tai Man",zh_hk,VIP'
    expect(parseCsv(text)).toEqual({
      phoneHeaderFound: true,
      rows: [
        {
          phoneE164: '+85290001234',
          name: 'Chan, Tai Man',
          preferredLanguage: 'zh_hk',
          tags: ['VIP'],
          ignoredTagCount: 0,
        },
      ],
      rejected: [],
    })
  })

  it('T-A2.2 rejects the #148 row when the comma-containing name is not quoted', () => {
    const text = 'phone,name,preferred_language,tags\n+85290001234,Chan, Tai Man,zh_hk,VIP'
    expect(parseCsv(text)).toEqual({
      phoneHeaderFound: true,
      rows: [],
      rejected: [{ line: 2, reason: 'column_count_mismatch', expected: 4, actual: 5, phone: '+85290001234' }],
    })
  })

  it('T-A2.3 rejects a row with fewer cells than the header', () => {
    const text = 'phone,name,preferred_language,tags\n+85299999999,Wong'
    const result = parseCsv(text)
    expect(result.rows).toEqual([])
    expect(result.rejected).toEqual([
      { line: 2, reason: 'column_count_mismatch', expected: 4, actual: 2, phone: '+85299999999' },
    ])
  })

  it('T-A2.4 accepts trailing empty fields (Excel/Sheets export)', () => {
    const text = 'phone,name,preferred_language,tags\n+85299999999,Wong,,'
    const result = parseCsv(text)
    expect(result.rows).toEqual([
      { phoneE164: '+85299999999', name: 'Wong', preferredLanguage: null, tags: [], ignoredTagCount: 0 },
    ])
    expect(result.rejected).toEqual([])
  })

  it('T-A2.5 rejects an unterminated quote, keeping rows parsed before it', () => {
    const text = 'phone,name\n+85291111111,Ann\n+85292222222,"open'
    const result = parseCsv(text)
    expect(result.rows).toEqual([
      { phoneE164: '+85291111111', name: 'Ann', preferredLanguage: null, tags: [], ignoredTagCount: 0 },
    ])
    expect(result.rejected).toEqual([
      { line: 3, reason: 'unterminated_quote', expected: 2, actual: 2, phone: '+85292222222' },
    ])
  })

  it('T-A2.6 an unterminated quote in the last column is unterminated_quote even with the right cell count', () => {
    const text = 'phone,name\n+85293333333,"still open'
    const result = parseCsv(text)
    expect(result.rejected).toEqual([
      { line: 2, reason: 'unterminated_quote', expected: 2, actual: 2, phone: '+85293333333' },
    ])
  })

  it('T-A2.7 strips a leading BOM before matching the header', () => {
    const text = '﻿phone\n+85291234567'
    const result = parseCsv(text)
    expect(result.phoneHeaderFound).toBe(true)
    expect(result.rows).toEqual([
      { phoneE164: '+85291234567', name: null, preferredLanguage: null, tags: [], ignoredTagCount: 0 },
    ])
  })

  it('T-A2.8 reports no phone header for empty text and for a header missing every phone alias', () => {
    expect(parseCsv('')).toEqual({ phoneHeaderFound: false, rows: [], rejected: [] })
    expect(parseCsv('name,tags\nWong,VIP')).toEqual({ phoneHeaderFound: false, rows: [], rejected: [] })
  })

  it('T-A2.9 reports phoneHeaderFound for a header-only file', () => {
    expect(parseCsv('phone,name,preferred_language,tags\n')).toEqual({
      phoneHeaderFound: true,
      rows: [],
      rejected: [],
    })
  })

  it('T-A2.10 skips a blank-phone row silently, not as a rejection', () => {
    const text = 'phone,name\n,Wong\n+85291234567,Tam'
    const result = parseCsv(text)
    expect(result.rows).toEqual([
      { phoneE164: '+85291234567', name: 'Tam', preferredLanguage: null, tags: [], ignoredTagCount: 0 },
    ])
    expect(result.rejected).toEqual([])
  })

  it('T-A2.11 keeps physical line numbers after a blank line and an embedded-newline record', () => {
    const text = 'phone,name\n\n+85291111111,"multi\nline"\n+85292222222,Extra,Cell'
    const result = parseCsv(text)
    expect(result.rows).toEqual([
      { phoneE164: '+85291111111', name: 'multi\nline', preferredLanguage: null, tags: [], ignoredTagCount: 0 },
    ])
    expect(result.rejected).toEqual([
      { line: 5, reason: 'column_count_mismatch', expected: 2, actual: 3, phone: '+85292222222' },
    ])
  })

  it('T-A2.12 matches quoted header cells against the aliases', () => {
    const text = '"phone","name"\n+85291234567,Wong'
    const result = parseCsv(text)
    expect(result.phoneHeaderFound).toBe(true)
    expect(result.rows[0]).toEqual({
      phoneE164: '+85291234567',
      name: 'Wong',
      preferredLanguage: null,
      tags: [],
      ignoredTagCount: 0,
    })
  })

  it('T-A2.13 reports a null phone on a rejection when the phone cell is empty or the record is shorter than the phone index', () => {
    const emptyPhone = parseCsv('phone,name,preferred_language,tags\n,Wong,en,VIP,Extra').rejected
    expect(emptyPhone).toEqual([{ line: 2, reason: 'column_count_mismatch', expected: 4, actual: 5, phone: null }])

    const shortRecord = parseCsv('name,phone,tags\nWong').rejected
    expect(shortRecord).toEqual([{ line: 2, reason: 'column_count_mismatch', expected: 3, actual: 1, phone: null }])
  })

  it('T-A2.14 a rejected row can never mint a tag', () => {
    const text = 'phone,name,preferred_language,tags\n+85290001234,Chan, Tai Man,zh_hk,VIP'
    const result = parseCsv(text)
    expect(result.rows).toEqual([])
    const allTags = result.rows.flatMap((row) => row.tags)
    expect(allTags).toEqual([])
    expect(allTags).not.toContain('zh_hk')
  })
})

describe('parseCsv — unterminated quote on the header line (grok review, Important)', () => {
  it('T-A2.15 rejects line 1 with unterminated_quote instead of reporting the file as empty', () => {
    const text = 'phone,"name\n+85291234567,Chan\n+85291234568,Tam\n'
    expect(parseCsv(text)).toEqual({
      phoneHeaderFound: true,
      rows: [],
      rejected: [{ line: 1, reason: 'unterminated_quote', expected: 2, actual: 2, phone: null }],
    })
  })

  it('T-A2.16 still reports empty when the unterminated header has no phone alias', () => {
    expect(parseCsv('"name,lang\n+85291234567,en\n')).toEqual({ phoneHeaderFound: false, rows: [], rejected: [] })
  })
})

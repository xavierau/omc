import { describe, it, expect } from 'vitest'
import { parseCsv } from '@/components/dashboard/import-wizard/parse-csv'

describe('parseCsv', () => {
  it('parses minimal phone-only header', () => {
    const text = 'phone\n+85291234567\n+85299999999'
    expect(parseCsv(text)).toEqual([
      { phoneE164: '+85291234567', name: null, preferredLanguage: null, tags: [] },
      { phoneE164: '+85299999999', name: null, preferredLanguage: null, tags: [] },
    ])
  })

  it('parses phone, name, preferred_language headers in any order', () => {
    const text = 'name,phone,preferred_language\nWong,+85291234567,zh_hk'
    expect(parseCsv(text)).toEqual([
      { phoneE164: '+85291234567', name: 'Wong', preferredLanguage: 'zh_hk', tags: [] },
    ])
  })

  it('skips empty rows', () => {
    const text = 'phone\n+85291234567\n\n+85299999999\n'
    expect(parseCsv(text)).toHaveLength(2)
  })

  it('returns empty array for header-only input', () => {
    expect(parseCsv('phone\n')).toEqual([])
  })

  it('trims whitespace from cells', () => {
    const text = 'phone, name\n  +85291234567 ,  Wong  '
    expect(parseCsv(text)).toEqual([
      { phoneE164: '+85291234567', name: 'Wong', preferredLanguage: null, tags: [] },
    ])
  })

  it('normalises preferred_language case', () => {
    const text = 'phone,preferred_language\n+85291234567,EN'
    expect(parseCsv(text)[0].preferredLanguage).toBe('en')
  })

  it('drops rows missing phone column', () => {
    const text = 'phone,name\n,Wong\n+85291234567,Tam'
    expect(parseCsv(text)).toEqual([
      { phoneE164: '+85291234567', name: 'Tam', preferredLanguage: null, tags: [] },
    ])
  })

  it('parses tags column split on ";", trimmed and deduped (T-B1.9/T-B1.1)', () => {
    const text = 'phone,tags\n+85291234567,vip; lunch ;VIP'
    expect(parseCsv(text)[0].tags).toEqual(['vip', 'lunch'])
  })

  it('accepts the singular "tag" header alias (T-B1.10)', () => {
    const text = 'phone,tag\n+85291234567,vip'
    expect(parseCsv(text)[0].tags).toEqual(['vip'])
  })

  it('defaults tags to [] when no tags header is present (T-B1.9)', () => {
    const text = 'phone,name\n+85291234567,Tam'
    expect(parseCsv(text)[0].tags).toEqual([])
  })
})

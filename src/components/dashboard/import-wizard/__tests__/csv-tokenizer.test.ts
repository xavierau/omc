import { describe, it, expect } from 'vitest'
import { tokenizeCsv } from '@/components/dashboard/import-wizard/csv-tokenizer'

describe('tokenizeCsv', () => {
  it('T-A1.1 tokenizes plain comma-separated fields', () => {
    const records = tokenizeCsv('a,b,c\n1,2,3')
    expect(records).toEqual([
      { line: 1, cells: ['a', 'b', 'c'], unterminated: false },
      { line: 2, cells: ['1', '2', '3'], unterminated: false },
    ])
  })

  it('T-A1.2 keeps a comma inside quotes as part of the cell', () => {
    const [record] = tokenizeCsv('x,"Chan, Tai Man",y')
    expect(record.cells).toEqual(['x', 'Chan, Tai Man', 'y'])
  })

  it('T-A1.3 resolves a doubled quote to one literal quote', () => {
    const [record] = tokenizeCsv('"He said ""hi""",z')
    expect(record.cells[0]).toBe('He said "hi"')
  })

  it('T-A1.4 keeps an embedded newline inside a quoted field and keeps counting lines', () => {
    const records = tokenizeCsv('"line1\nline2",z\nnext,row')
    expect(records[0].cells[0]).toBe('line1\nline2')
    expect(records[1].line).toBe(3)
  })

  it('T-A1.5 strips CRLF terminators from cells', () => {
    const records = tokenizeCsv('a,b\r\n1,2\r\n')
    expect(records).toHaveLength(2)
    for (const record of records) {
      for (const cell of record.cells) expect(cell).not.toContain('\r')
    }
  })

  it('T-A1.6 treats a lone CR as a line terminator', () => {
    expect(tokenizeCsv('a,b\r1,2')).toHaveLength(2)
  })

  it('T-A1.7 strips a leading BOM', () => {
    const [record] = tokenizeCsv('﻿phone,name\n+85291234567,Wong')
    expect(record.cells[0]).toBe('phone')
  })

  it('T-A1.8 keeps trailing empty fields', () => {
    const records = tokenizeCsv('a,b,\n1,,')
    expect(records[0].cells).toEqual(['a', 'b', ''])
    expect(records[1].cells).toEqual(['1', '', ''])
  })

  it('T-A1.9 marks only the final record unterminated when EOF is reached inside quotes', () => {
    const records = tokenizeCsv('a,b\n1,"open\n2,3')
    expect(records).toEqual([
      { line: 1, cells: ['a', 'b'], unterminated: false },
      { line: 2, cells: ['1', 'open\n2,3'], unterminated: true },
    ])
  })

  it('T-A1.10 skips blank lines but keeps physical line numbers', () => {
    const records = tokenizeCsv('a\n\n  \nb')
    expect(records.map((r) => r.line)).toEqual([1, 4])
  })

  it('T-A1.11 recognises an opening quote after leading spaces', () => {
    const [record] = tokenizeCsv('a, "b, c"')
    expect(record.cells).toEqual(['a', 'b, c'])
  })

  it('T-A1.12 treats a quote that is not at field start as a literal character', () => {
    const [record] = tokenizeCsv('ab"c,d')
    expect(record.cells[0]).toBe('ab"c')
  })

  it('T-A1.13 appends text following a closing quote to the same cell', () => {
    const [record] = tokenizeCsv('"ab"cd,e')
    expect(record.cells[0]).toBe('abcd')
  })

  it('T-A1.14 emits the final record without a trailing newline; empty input yields no records', () => {
    expect(tokenizeCsv('')).toEqual([])
    expect(tokenizeCsv('\n\n')).toEqual([])
    const records = tokenizeCsv('a\n\n  \nb')
    expect(records[records.length - 1].cells).toEqual(['b'])
  })

  it('T-A1.perf tokenizes 50,000 rows within budget (plain and quoted)', () => {
    const plain = buildRows(50_000, false)
    const t0 = Date.now()
    const plainRecords = tokenizeCsv(plain)
    const plainMs = Date.now() - t0

    const quoted = buildRows(50_000, true)
    const t1 = Date.now()
    const quotedRecords = tokenizeCsv(quoted)
    const quotedMs = Date.now() - t1

    expect(plainRecords).toHaveLength(50_001)
    expect(quotedRecords).toHaveLength(50_001)
    expect(plainMs).toBeLessThan(2000)
    expect(quotedMs).toBeLessThan(2000)
  })
})

function buildRows(count: number, quoted: boolean): string {
  const lines = ['phone,name,preferred_language,tags']
  for (let i = 0; i < count; i++) {
    const name = quoted ? `"Chan, Tai Man ${i}"` : `Chan Tai Man ${i}`
    lines.push(`+852${String(i).padStart(8, '0')},${name},en,VIP`)
  }
  return lines.join('\n')
}

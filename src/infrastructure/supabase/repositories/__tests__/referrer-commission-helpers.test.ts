import { describe, it, expect } from 'vitest'
import { buildKey, filterOutPaid } from '../referrer-commission-repository'

describe('buildKey', () => {
  it('builds composite key from row fields', () => {
    const row = { referrer_id: 'ref-1', month: '2026-03', tenant_id: 'ten-1' }
    expect(buildKey(row)).toBe('ref-1|2026-03|ten-1')
  })

  it('handles undefined fields gracefully', () => {
    const row = { referrer_id: 'ref-1', month: undefined, tenant_id: 'ten-1' }
    expect(buildKey(row)).toBe('ref-1|undefined|ten-1')
  })
})

describe('filterOutPaid', () => {
  const row1 = { referrer_id: 'ref-1', month: '2026-03', tenant_id: 'ten-1' }
  const row2 = { referrer_id: 'ref-1', month: '2026-03', tenant_id: 'ten-2' }
  const row3 = { referrer_id: 'ref-2', month: '2026-04', tenant_id: 'ten-1' }

  it('removes rows whose key is in the paid set', () => {
    const paidKeys = new Set(['ref-1|2026-03|ten-1'])
    const result = filterOutPaid([row1, row2, row3], paidKeys)
    expect(result).toEqual([row2, row3])
  })

  it('returns all rows when paid set is empty', () => {
    const result = filterOutPaid([row1, row2], new Set())
    expect(result).toEqual([row1, row2])
  })

  it('returns empty array when all rows are paid', () => {
    const paidKeys = new Set(['ref-1|2026-03|ten-1', 'ref-1|2026-03|ten-2'])
    const result = filterOutPaid([row1, row2], paidKeys)
    expect(result).toEqual([])
  })

  it('returns empty array for empty input', () => {
    const result = filterOutPaid([], new Set(['ref-1|2026-03|ten-1']))
    expect(result).toEqual([])
  })
})

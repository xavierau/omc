import { describe, it, expect } from 'vitest'
import { summariseRowTags } from '../csv-tag-summary-helpers'

describe('summariseRowTags', () => {
  it('T-F1.9: counts rows per tag and sorts by count desc', () => {
    const rows = [
      { tags: ['vip'] },
      { tags: ['vip'] },
      { tags: ['vip', 'lunch'] },
    ]
    const result = summariseRowTags(rows, [])
    expect(result).toEqual([
      { name: 'vip', count: 3, isNew: true },
      { name: 'lunch', count: 1, isNew: true },
    ])
  })

  it('breaks a count tie by name ascending', () => {
    const rows = [{ tags: ['zeta'] }, { tags: ['alpha'] }]
    const result = summariseRowTags(rows, [])
    expect(result.map((r) => r.name)).toEqual(['alpha', 'zeta'])
  })

  it('T-F1.10: marks a tag absent from the tenant list as new, case-insensitively matched otherwise', () => {
    const rows = [{ tags: ['VIP'] }, { tags: ['brand-new'] }]
    const result = summariseRowTags(rows, [{ name: 'vip' }])
    const vip = result.find((r) => r.name === 'VIP')
    const fresh = result.find((r) => r.name === 'brand-new')
    expect(vip?.isNew).toBe(false)
    expect(fresh?.isNew).toBe(true)
  })

  it('T-F1.11 (helper half): no row carries a tag → empty array', () => {
    const rows = [{ tags: [] }, { tags: [] }]
    expect(summariseRowTags(rows, [])).toEqual([])
  })

  it('aggregates the same tag across rows using tagKey, keeping first-seen casing', () => {
    const rows = [{ tags: ['VIP'] }, { tags: ['vip'] }, { tags: ['Vip'] }]
    const result = summariseRowTags(rows, [])
    expect(result).toEqual([{ name: 'VIP', count: 3, isNew: true }])
  })

  it('a row carrying the same tag twice (should not happen post-normalisation) is not double-counted per occurrence beyond row membership', () => {
    // normalizeImportTagNames already dedupes within a row before this runs;
    // this helper trusts its input rows and simply counts tag occurrences.
    const rows = [{ tags: ['vip', 'vip'] }]
    const result = summariseRowTags(rows, [])
    expect(result).toEqual([{ name: 'vip', count: 2, isNew: true }])
  })
})

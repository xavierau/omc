import { describe, it, expect } from 'vitest'
import { currentMonth, parseMonthRange } from '../month-range'

describe('currentMonth', () => {
  it('returns YYYY-MM format', () => {
    const result = currentMonth()
    expect(result).toMatch(/^\d{4}-\d{2}$/)
  })
})

describe('parseMonthRange', () => {
  it('returns correct UTC ISO date range for April 2026', () => {
    const result = parseMonthRange('2026-04')
    expect(result.monthStart).toBe('2026-04-01T00:00:00.000Z')
    expect(result.monthEnd).toBe('2026-05-01T00:00:00.000Z')
  })

  it('handles December to January boundary', () => {
    const result = parseMonthRange('2026-12')
    expect(result.monthStart).toBe('2026-12-01T00:00:00.000Z')
    expect(result.monthEnd).toBe('2027-01-01T00:00:00.000Z')
  })
})

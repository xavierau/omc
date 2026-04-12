import { describe, it, expect } from 'vitest'
import {
  isValidCommissionRate,
  DEFAULT_COMMISSION_HKD,
  MAX_COMMISSION_HKD,
} from '@/domain/value-objects/commission-rate'

describe('isValidCommissionRate', () => {
  it.each([0, 0.05, 0.5, 1])('returns true for %s', (rate) => {
    expect(isValidCommissionRate(rate)).toBe(true)
  })

  it.each([-0.01, 1.01, NaN, Infinity])('returns false for %s', (rate) => {
    expect(isValidCommissionRate(rate)).toBe(false)
  })
})

describe('constants', () => {
  it('DEFAULT_COMMISSION_HKD is 0.05', () => {
    expect(DEFAULT_COMMISSION_HKD).toBe(0.05)
  })

  it('MAX_COMMISSION_HKD is 1', () => {
    expect(MAX_COMMISSION_HKD).toBe(1)
  })
})

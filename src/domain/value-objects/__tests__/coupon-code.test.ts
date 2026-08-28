import { describe, it, expect } from 'vitest'
import {
  generateCouponCode,
  isValidCouponCode,
} from '@/domain/value-objects/coupon-code'

const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

describe('generateCouponCode', () => {
  it('returns a string of length 6', () => {
    const code = generateCouponCode()
    expect(code).toHaveLength(6)
  })

  it('only contains characters from the allowed charset', () => {
    const code = generateCouponCode()
    for (const char of code) {
      expect(CHARSET).toContain(char)
    }
  })

  it('produces different codes across multiple calls', () => {
    const codes = new Set(
      Array.from({ length: 10 }, () => generateCouponCode())
    )
    expect(codes.size).toBeGreaterThan(1)
  })
})

describe('isValidCouponCode', () => {
  it('accepts valid alphanumeric codes of 3-20 chars', () => {
    expect(isValidCouponCode('ABC123')).toBe(true)
  })

  it('rejects codes with special characters', () => {
    expect(isValidCouponCode('ABC-123')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isValidCouponCode('')).toBe(false)
  })
})

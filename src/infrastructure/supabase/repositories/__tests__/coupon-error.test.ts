import { describe, it, expect } from 'vitest'
import { isCouponUniqueViolation } from '../coupon-error'

describe('isCouponUniqueViolation', () => {
  it('matches on the preserved pg .code (23505)', () => {
    expect(isCouponUniqueViolation(Object.assign(new Error('x'), { code: '23505' }))).toBe(true)
  })

  it('matches on the wrapped message when the code is lost', () => {
    expect(
      isCouponUniqueViolation(
        new Error(
          'createCoupon: duplicate key value violates unique constraint "uniq_coupon_campaign_member"'
        )
      )
    ).toBe(true)
    expect(isCouponUniqueViolation(new Error('SQLSTATE 23505'))).toBe(true)
  })

  it('is false for unrelated errors and non-errors', () => {
    expect(isCouponUniqueViolation(new Error('connection reset'))).toBe(false)
    expect(isCouponUniqueViolation(Object.assign(new Error('x'), { code: '23503' }))).toBe(false)
    expect(isCouponUniqueViolation(null)).toBe(false)
    expect(isCouponUniqueViolation(undefined)).toBe(false)
  })
})

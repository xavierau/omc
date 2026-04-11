import { describe, it, expect } from 'vitest'
import {
  checkMonthlyLimit,
  checkUnsubscribeRate,
  checkDailyFrequency,
  checkCampaignPaused,
  isApproachingLimit,
} from '../campaign-guardrails'

describe('checkMonthlyLimit', () => {
  it('allows when sends + target < limit', () => {
    const result = checkMonthlyLimit(500, 200, 1000)
    expect(result.allowed).toBe(true)
    expect(result.reason).toBeUndefined()
  })

  it('blocks when sends + target >= limit', () => {
    const result = checkMonthlyLimit(800, 300, 1000)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBeDefined()
  })

  it('blocks when sends already at limit with target=0', () => {
    const result = checkMonthlyLimit(1000, 0, 1000)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBeDefined()
  })
})

describe('checkUnsubscribeRate', () => {
  it('allows when rate < max (3% < 5%)', () => {
    const result = checkUnsubscribeRate(100, 3, 0.05)
    expect(result.allowed).toBe(true)
  })

  it('blocks when rate >= max (6% >= 5%)', () => {
    const result = checkUnsubscribeRate(100, 6, 0.05)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBeDefined()
  })

  it('allows when 0 members (no division by zero)', () => {
    const result = checkUnsubscribeRate(0, 0, 0.05)
    expect(result.allowed).toBe(true)
  })
})

describe('checkDailyFrequency', () => {
  it('allows first campaign of day', () => {
    const result = checkDailyFrequency(0, 1)
    expect(result.allowed).toBe(true)
  })

  it('blocks second campaign when limit=1', () => {
    const result = checkDailyFrequency(1, 1)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBeDefined()
  })
})

describe('checkCampaignPaused', () => {
  it('blocks when paused=true and includes reason', () => {
    const result = checkCampaignPaused(true, 'High unsubscribe rate')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('High unsubscribe rate')
  })

  it('allows when paused=false', () => {
    const result = checkCampaignPaused(false)
    expect(result.allowed).toBe(true)
  })
})

describe('isApproachingLimit', () => {
  it('returns true at 80% threshold', () => {
    expect(isApproachingLimit(800, 1000)).toBe(true)
  })

  it('returns false below threshold', () => {
    expect(isApproachingLimit(700, 1000)).toBe(false)
  })
})

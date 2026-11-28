import { describe, it, expect } from 'vitest'
import {
  isQualityRating,
  isMessagingTier,
  isDegradation,
  isRecovery,
  type QualityRating,
} from '../quality-rating'

describe('isQualityRating', () => {
  it('accepts the four canonical strings', () => {
    expect(isQualityRating('GREEN')).toBe(true)
    expect(isQualityRating('YELLOW')).toBe(true)
    expect(isQualityRating('RED')).toBe(true)
    expect(isQualityRating('UNKNOWN')).toBe(true)
  })
  it('rejects lower-case and unknown values', () => {
    expect(isQualityRating('green')).toBe(false)
    expect(isQualityRating('orange')).toBe(false)
    expect(isQualityRating(null)).toBe(false)
    expect(isQualityRating(undefined)).toBe(false)
    expect(isQualityRating(7)).toBe(false)
  })
})

describe('isMessagingTier', () => {
  it('accepts canonical Meta tiers', () => {
    expect(isMessagingTier('TIER_1K')).toBe(true)
    expect(isMessagingTier('TIER_10K')).toBe(true)
    expect(isMessagingTier('TIER_100K')).toBe(true)
    expect(isMessagingTier('TIER_UNLIMITED')).toBe(true)
  })
  it('treats other strings as opaque tier identifiers (forward-compat)', () => {
    // Meta has shipped TIER_NOT_SET, TIER_50, etc. We accept any string so
    // a future tier name does not require a code change.
    expect(isMessagingTier('TIER_NOT_SET')).toBe(true)
    expect(isMessagingTier('TIER_250')).toBe(true)
  })
  it('rejects non-strings', () => {
    expect(isMessagingTier(null)).toBe(false)
    expect(isMessagingTier(undefined)).toBe(false)
    expect(isMessagingTier(7)).toBe(false)
    expect(isMessagingTier('')).toBe(false)
  })
})

describe('isDegradation', () => {
  const cases: Array<[QualityRating, QualityRating, boolean]> = [
    ['GREEN', 'YELLOW', true],
    ['GREEN', 'RED', true],
    ['YELLOW', 'RED', true],
    ['GREEN', 'GREEN', false],
    ['YELLOW', 'GREEN', false],
    ['RED', 'YELLOW', false],
    ['RED', 'GREEN', false],
    ['UNKNOWN', 'YELLOW', false], // unknown -> known is not a degradation
    ['GREEN', 'UNKNOWN', false], // known -> unknown is not a degradation
    ['UNKNOWN', 'UNKNOWN', false],
  ]
  it.each(cases)('isDegradation(%s, %s) === %s', (from, to, expected) => {
    expect(isDegradation(from, to)).toBe(expected)
  })
})

describe('isRecovery', () => {
  const cases: Array<[QualityRating, QualityRating, boolean]> = [
    ['YELLOW', 'GREEN', true],
    ['RED', 'YELLOW', true],
    ['RED', 'GREEN', true],
    ['GREEN', 'GREEN', false],
    ['GREEN', 'YELLOW', false],
    ['UNKNOWN', 'GREEN', false],
    ['GREEN', 'UNKNOWN', false],
  ]
  it.each(cases)('isRecovery(%s, %s) === %s', (from, to, expected) => {
    expect(isRecovery(from, to)).toBe(expected)
  })
})

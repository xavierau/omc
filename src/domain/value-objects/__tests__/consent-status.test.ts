import { describe, it, expect } from 'vitest'
import {
  GRADES,
  isConsentCategory,
  isConsentGrade,
  isConsentStatus,
} from '../consent-status'

describe('consent type guards', () => {
  it('isConsentStatus accepts the three lifecycle values', () => {
    expect(isConsentStatus('opted_in')).toBe(true)
    expect(isConsentStatus('opted_out')).toBe(true)
    expect(isConsentStatus('pending')).toBe(true)
  })

  it('isConsentStatus rejects unknown strings and non-strings', () => {
    expect(isConsentStatus('approved')).toBe(false)
    expect(isConsentStatus('')).toBe(false)
    expect(isConsentStatus(null)).toBe(false)
    expect(isConsentStatus(undefined)).toBe(false)
    expect(isConsentStatus(0)).toBe(false)
  })

  it('isConsentCategory accepts marketing/utility/authentication', () => {
    expect(isConsentCategory('marketing')).toBe(true)
    expect(isConsentCategory('utility')).toBe(true)
    expect(isConsentCategory('authentication')).toBe(true)
    // 'service' is a message-direction category but NOT a consent category
    expect(isConsentCategory('service')).toBe(false)
  })

  it('isConsentGrade accepts strong/medium/weak/none (4-level grading)', () => {
    expect(isConsentGrade('strong')).toBe(true)
    expect(isConsentGrade('medium')).toBe(true)
    expect(isConsentGrade('weak')).toBe(true)
    expect(isConsentGrade('none')).toBe(true)
  })

  it('isConsentGrade rejects unknown strings and non-strings', () => {
    expect(isConsentGrade('approved')).toBe(false)
    expect(isConsentGrade('')).toBe(false)
    expect(isConsentGrade(null)).toBe(false)
    expect(isConsentGrade(undefined)).toBe(false)
    expect(isConsentGrade(0)).toBe(false)
  })

  it('GRADES locks the 4-level contract (length + order)', () => {
    // A future widen requires explicit test update — protects WONB-005's
    // strong/medium/weak/none semantics from accidental drift.
    expect(GRADES).toEqual(['strong', 'medium', 'weak', 'none'])
  })
})

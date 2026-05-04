import { describe, it, expect } from 'vitest'
import {
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

  it('isConsentGrade accepts strong/weak only', () => {
    expect(isConsentGrade('strong')).toBe(true)
    expect(isConsentGrade('weak')).toBe(true)
    expect(isConsentGrade('medium')).toBe(false)
  })
})

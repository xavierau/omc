import { describe, expect, it } from 'vitest'
import {
  covers,
  effectiveLevel,
  isConsentLevel,
  permits,
  requiredLevelFor,
} from '../consent-level'

describe('consent-level', () => {
  it('requiredLevelFor maps utility->utility, marketing->all', () => {
    expect(requiredLevelFor('utility')).toBe('utility')
    expect(requiredLevelFor('marketing')).toBe('all')
  })

  it('covers/permits agree and follow the required-level table', () => {
    expect(covers('none', 'utility')).toBe(false)
    expect(covers('utility', 'utility')).toBe(true)
    expect(covers('all', 'utility')).toBe(true)
    expect(covers('none', 'marketing')).toBe(false)
    expect(covers('utility', 'marketing')).toBe(false)
    expect(covers('all', 'marketing')).toBe(true)
    expect(permits('all', 'marketing')).toBe(covers('all', 'marketing'))
  })

  it('effectiveLevel: all requires both opted_in', () => {
    expect(effectiveLevel('opted_in', 'opted_in')).toBe('all')
    expect(effectiveLevel('opted_in', 'pending')).toBe('utility')
    expect(effectiveLevel('opted_in', 'opted_out')).toBe('utility')
    expect(effectiveLevel('opted_in', null)).toBe('utility')
    expect(effectiveLevel(null, 'opted_in')).toBe('none')
    expect(effectiveLevel('pending', 'opted_in')).toBe('none')
    expect(effectiveLevel(null, null)).toBe('none')
  })

  it('isConsentLevel narrows unknown values', () => {
    expect(isConsentLevel('all')).toBe(true)
    expect(isConsentLevel('utility')).toBe(true)
    expect(isConsentLevel('none')).toBe(true)
    expect(isConsentLevel('marketing')).toBe(false)
    expect(isConsentLevel(42)).toBe(false)
  })
})

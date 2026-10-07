import { describe, it, expect } from 'vitest'
import {
  isOnboardingPath,
  ONBOARDING_PATHS,
  type OnboardingPath,
} from '../onboarding-path'

describe('isOnboardingPath', () => {
  it('accepts the four canonical path codes', () => {
    expect(isOnboardingPath('A')).toBe(true)
    expect(isOnboardingPath('B1')).toBe(true)
    expect(isOnboardingPath('B2')).toBe(true)
    expect(isOnboardingPath('B3')).toBe(true)
  })

  it('rejects unknown / lower-case / non-string values', () => {
    expect(isOnboardingPath('a')).toBe(false)
    expect(isOnboardingPath('B')).toBe(false)
    expect(isOnboardingPath('B4')).toBe(false)
    expect(isOnboardingPath('')).toBe(false)
    expect(isOnboardingPath(null)).toBe(false)
    expect(isOnboardingPath(undefined)).toBe(false)
    expect(isOnboardingPath(1)).toBe(false)
  })

  it('exposes a frozen list of canonical path codes', () => {
    expect(ONBOARDING_PATHS).toEqual(['A', 'B1', 'B2', 'B3'])
    expect(Object.isFrozen(ONBOARDING_PATHS)).toBe(true)
  })

  it('typing: each canonical path is assignable to OnboardingPath', () => {
    const a: OnboardingPath = 'A'
    const b1: OnboardingPath = 'B1'
    expect([a, b1]).toEqual(['A', 'B1'])
  })
})

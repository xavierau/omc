import { describe, it, expect } from 'vitest'
import {
  isOnboardingPhase,
  ONBOARDING_PHASES,
  nextPhase,
  isAdvanceLegal,
  type OnboardingPhase,
} from '../onboarding-phase'

describe('isOnboardingPhase', () => {
  it('accepts the six canonical phases', () => {
    for (const p of ['setup', 'probe', 'build', 'scale', 'full', 'steady']) {
      expect(isOnboardingPhase(p)).toBe(true)
    }
  })

  it('rejects unknown / non-string values', () => {
    expect(isOnboardingPhase('SETUP')).toBe(false)
    expect(isOnboardingPhase('terminal')).toBe(false)
    expect(isOnboardingPhase(null)).toBe(false)
    expect(isOnboardingPhase(undefined)).toBe(false)
    expect(isOnboardingPhase(0)).toBe(false)
  })

  it('exposes a frozen ordered list', () => {
    expect(ONBOARDING_PHASES).toEqual([
      'setup',
      'probe',
      'build',
      'scale',
      'full',
      'steady',
    ])
    expect(Object.isFrozen(ONBOARDING_PHASES)).toBe(true)
  })
})

describe('nextPhase', () => {
  const cases: Array<[OnboardingPhase, OnboardingPhase | null]> = [
    ['setup', 'probe'],
    ['probe', 'build'],
    ['build', 'scale'],
    ['scale', 'full'],
    ['full', 'steady'],
    ['steady', null],
  ]
  it.each(cases)('path A: %s -> %s', (cur, expected) => {
    expect(nextPhase('A', cur)).toBe(expected)
  })

  it('paths B1/B2/B3 share the same linear order in WONB-001', () => {
    expect(nextPhase('B1', 'setup')).toBe('probe')
    expect(nextPhase('B2', 'probe')).toBe('build')
    expect(nextPhase('B3', 'full')).toBe('steady')
  })
})

describe('isAdvanceLegal', () => {
  it('returns true for adjacent forward transitions', () => {
    expect(isAdvanceLegal('A', 'setup', 'probe')).toBe(true)
    expect(isAdvanceLegal('B1', 'full', 'steady')).toBe(true)
  })

  it('rejects same-phase, backward and skipping transitions', () => {
    expect(isAdvanceLegal('A', 'setup', 'setup')).toBe(false)
    expect(isAdvanceLegal('A', 'probe', 'setup')).toBe(false)
    expect(isAdvanceLegal('A', 'setup', 'build')).toBe(false)
  })

  it('rejects advancing from terminal phase steady', () => {
    expect(isAdvanceLegal('A', 'steady', 'steady')).toBe(false)
  })
})

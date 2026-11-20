import { describe, it, expect } from 'vitest'
import { canProceedFromStep1, canProceedFromStep2 } from '../use-wizard-validation'
import { INITIAL_WIZARD_DATA, type WizardData } from '../types'

const validStep1: WizardData = {
  name: 'Test Restaurant',
  slug: 'test-restaurant',
  adminEmail: 'admin@test.com',
  adminPassword: 'password123',
  whatsappNumber: '+852 1234 5678',
  kapsoPhoneNumberId: '',
  metaBusinessAccountId: '',
}

describe('canProceedFromStep1', () => {
  it('returns true when all required fields are filled', () => {
    expect(canProceedFromStep1(validStep1)).toBe(true)
  })

  it('returns false when name is empty', () => {
    expect(canProceedFromStep1({ ...validStep1, name: '' })).toBe(false)
  })

  it('returns false when slug is empty', () => {
    expect(canProceedFromStep1({ ...validStep1, slug: '' })).toBe(false)
  })

  it('returns false when slug has invalid format', () => {
    expect(canProceedFromStep1({ ...validStep1, slug: 'Has Spaces' })).toBe(false)
    expect(canProceedFromStep1({ ...validStep1, slug: 'UPPERCASE' })).toBe(false)
    expect(canProceedFromStep1({ ...validStep1, slug: 'special!chars' })).toBe(false)
  })

  it('returns false when email is empty', () => {
    expect(canProceedFromStep1({ ...validStep1, adminEmail: '' })).toBe(false)
  })

  it('returns false when email has invalid format', () => {
    expect(canProceedFromStep1({ ...validStep1, adminEmail: 'not-an-email' })).toBe(false)
    expect(canProceedFromStep1({ ...validStep1, adminEmail: 'missing@domain' })).toBe(false)
  })

  it('returns false when password is too short', () => {
    expect(canProceedFromStep1({ ...validStep1, adminPassword: 'short' })).toBe(false)
  })

  it('returns false when whatsapp number is empty', () => {
    expect(canProceedFromStep1({ ...validStep1, whatsappNumber: '' })).toBe(false)
  })

  it('returns false for initial empty data', () => {
    expect(canProceedFromStep1(INITIAL_WIZARD_DATA)).toBe(false)
  })
})

describe('canProceedFromStep2', () => {
  it('returns true when validated', () => {
    expect(canProceedFromStep2(true)).toBe(true)
  })

  it('returns false when not validated', () => {
    expect(canProceedFromStep2(false)).toBe(false)
  })
})

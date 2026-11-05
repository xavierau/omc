import { describe, it, expect } from 'vitest'
import {
  isValidEmail,
  isValidPhoneE164,
  isValidSlug,
  isValidUUID,
  validateRequired,
} from '../validators'

describe('isValidEmail', () => {
  it('accepts valid emails', () => {
    expect(isValidEmail('user@example.com')).toBe(true)
    expect(isValidEmail('test+tag@sub.domain.org')).toBe(true)
  })

  it('rejects invalid emails', () => {
    expect(isValidEmail('')).toBe(false)
    expect(isValidEmail('notanemail')).toBe(false)
    expect(isValidEmail('@missing.local')).toBe(false)
    expect(isValidEmail('no@')).toBe(false)
  })
})

describe('isValidPhoneE164', () => {
  it('accepts valid phone numbers', () => {
    expect(isValidPhoneE164('+85291234567')).toBe(true)
    expect(isValidPhoneE164('85291234567')).toBe(true)
    expect(isValidPhoneE164('+12025550123')).toBe(true)
    expect(isValidPhoneE164('12345678')).toBe(true)
  })

  it('rejects invalid phone numbers', () => {
    expect(isValidPhoneE164('')).toBe(false)
    expect(isValidPhoneE164('abc')).toBe(false)
    expect(isValidPhoneE164('1234567')).toBe(false) // too short (7 digits)
    expect(isValidPhoneE164('1234567890123456')).toBe(false) // too long (16 digits)
    expect(isValidPhoneE164('+852 9123 4567')).toBe(false) // inner spaces
    expect(isValidPhoneE164('+852-9123-4567')).toBe(false) // dashes
  })
})

describe('isValidSlug', () => {
  it('accepts valid slugs', () => {
    expect(isValidSlug('my-restaurant')).toBe(true)
    expect(isValidSlug('abc123')).toBe(true)
    expect(isValidSlug('a')).toBe(true)
  })

  it('rejects invalid slugs', () => {
    expect(isValidSlug('')).toBe(false)
    expect(isValidSlug('Has-Uppercase')).toBe(false)
    expect(isValidSlug('-leading')).toBe(false)
    expect(isValidSlug('trailing-')).toBe(false)
    expect(isValidSlug('has spaces')).toBe(false)
    expect(isValidSlug('a'.repeat(51))).toBe(false)
  })
})

describe('isValidUUID', () => {
  it('accepts valid UUIDs', () => {
    expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
  })

  it('rejects invalid UUIDs', () => {
    expect(isValidUUID('')).toBe(false)
    expect(isValidUUID('not-a-uuid')).toBe(false)
    expect(isValidUUID('550e8400e29b41d4a716446655440000')).toBe(false)
  })
})

describe('validateRequired', () => {
  it('does not throw for truthy values', () => {
    expect(() => validateRequired('hello', 'name')).not.toThrow()
    expect(() => validateRequired(123, 'count')).not.toThrow()
  })

  it('throws for falsy values', () => {
    expect(() => validateRequired('', 'name')).toThrow('name is required')
    expect(() => validateRequired(null, 'x')).toThrow('x is required')
    expect(() => validateRequired(undefined, 'x')).toThrow('x is required')
  })
})

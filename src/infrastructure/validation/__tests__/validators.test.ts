import { describe, it, expect } from 'vitest'
import {
  isValidEmail,
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

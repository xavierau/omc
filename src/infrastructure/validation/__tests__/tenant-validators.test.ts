import { describe, it, expect } from 'vitest'
import {
  validateCreateTenant,
  validateUpdateTenant,
  validateAddUser,
  ValidationError,
} from '../tenant-validators'

const VALID_CREATE_INPUT = {
  name: 'My Restaurant',
  slug: 'my-restaurant',
  whatsappNumber: '+85212345678',
  adminEmail: 'admin@example.com',
  adminPassword: 'securepass',
}

describe('validateCreateTenant', () => {
  it('does not throw for valid input', () => {
    expect(() => validateCreateTenant(VALID_CREATE_INPUT)).not.toThrow()
  })

  it('throws when name is missing', () => {
    expect(() =>
      validateCreateTenant({ ...VALID_CREATE_INPUT, name: '' })
    ).toThrow(ValidationError)
    expect(() =>
      validateCreateTenant({ ...VALID_CREATE_INPUT, name: '' })
    ).toThrow('name is required')
  })

  it('throws when name exceeds 100 characters', () => {
    expect(() =>
      validateCreateTenant({
        ...VALID_CREATE_INPUT,
        name: 'a'.repeat(101),
      })
    ).toThrow('100 characters')
  })

  it('throws for invalid slug', () => {
    expect(() =>
      validateCreateTenant({
        ...VALID_CREATE_INPUT,
        slug: 'INVALID SLUG',
      })
    ).toThrow(ValidationError)
  })

  it('throws for invalid email', () => {
    expect(() =>
      validateCreateTenant({
        ...VALID_CREATE_INPUT,
        adminEmail: 'not-an-email',
      })
    ).toThrow('Invalid email')
  })

  it('throws when password is shorter than 8 characters', () => {
    expect(() =>
      validateCreateTenant({
        ...VALID_CREATE_INPUT,
        adminPassword: 'short',
      })
    ).toThrow('at least 8 characters')
  })
})

describe('validateUpdateTenant', () => {
  const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000'

  it('throws for invalid UUID', () => {
    expect(() =>
      validateUpdateTenant('not-a-uuid', {})
    ).toThrow('Invalid tenant ID')
  })

  it('throws for invalid status value', () => {
    expect(() =>
      validateUpdateTenant(VALID_UUID, { status: 'suspended' })
    ).toThrow('status must be')
  })

  it('accepts valid status values', () => {
    expect(() =>
      validateUpdateTenant(VALID_UUID, { status: 'active' })
    ).not.toThrow()
    expect(() =>
      validateUpdateTenant(VALID_UUID, { status: 'trial' })
    ).not.toThrow()
  })
})

describe('validateAddUser', () => {
  it('does not throw for valid input', () => {
    expect(() =>
      validateAddUser({
        email: 'user@example.com',
        password: 'longpassword',
        role: 'admin',
      })
    ).not.toThrow()
  })

  it('throws for invalid role', () => {
    expect(() =>
      validateAddUser({
        email: 'user@example.com',
        password: 'longpassword',
        role: 'superadmin',
      })
    ).toThrow('role must be')
  })
})

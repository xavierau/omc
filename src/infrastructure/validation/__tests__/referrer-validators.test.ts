import { describe, it, expect } from 'vitest'
import {
  ReferrerValidationError,
  validateCreateReferrer,
  validateUpdateReferrer,
} from '../referrer-validators'

describe('validateCreateReferrer', () => {
  const valid = { name: 'Acme Corp', contactEmail: 'acme@example.com' }

  it('passes with valid input', () => {
    expect(() => validateCreateReferrer(valid)).not.toThrow()
  })

  it('passes with optional fields', () => {
    expect(() =>
      validateCreateReferrer({
        ...valid,
        contactPhone: '+852 1234 5678',
        commissionPerMessageHkd: 0.05,
      })
    ).not.toThrow()
  })

  it('throws when name is missing', () => {
    expect(() => validateCreateReferrer({ contactEmail: 'a@b.com' })).toThrow(
      ReferrerValidationError
    )
  })

  it('throws when name exceeds 100 characters', () => {
    expect(() =>
      validateCreateReferrer({ name: 'x'.repeat(101), contactEmail: 'a@b.com' })
    ).toThrow('name must be 100 characters or fewer')
  })

  it('throws when contactEmail is missing', () => {
    expect(() => validateCreateReferrer({ name: 'Test' })).toThrow(
      'Invalid email format'
    )
  })

  it('throws when contactEmail is invalid', () => {
    expect(() =>
      validateCreateReferrer({ name: 'Test', contactEmail: 'bad' })
    ).toThrow('Invalid email format')
  })

  it('throws when commissionPerMessageHkd is invalid', () => {
    expect(() =>
      validateCreateReferrer({ ...valid, commissionPerMessageHkd: 2 })
    ).toThrow('commissionPerMessageHkd must be between 0 and 1')
  })

  it('throws when commissionPerMessageHkd is negative', () => {
    expect(() =>
      validateCreateReferrer({ ...valid, commissionPerMessageHkd: -0.1 })
    ).toThrow('commissionPerMessageHkd must be between 0 and 1')
  })
})

describe('validateUpdateReferrer', () => {
  const validId = '550e8400-e29b-41d4-a716-446655440000'

  it('passes with valid id and empty body', () => {
    expect(() => validateUpdateReferrer(validId, {})).not.toThrow()
  })

  it('passes with valid optional fields', () => {
    expect(() =>
      validateUpdateReferrer(validId, {
        name: 'New Name',
        contactEmail: 'new@example.com',
        commissionPerMessageHkd: 0.1,
        status: 'inactive',
      })
    ).not.toThrow()
  })

  it('throws for invalid UUID', () => {
    expect(() => validateUpdateReferrer('bad-id', {})).toThrow(
      'Invalid referrer ID'
    )
  })

  it('throws for invalid status', () => {
    expect(() =>
      validateUpdateReferrer(validId, { status: 'deleted' })
    ).toThrow('status must be "active" or "inactive"')
  })

  it('throws for invalid name', () => {
    expect(() =>
      validateUpdateReferrer(validId, { name: 'x'.repeat(101) })
    ).toThrow('name must be 100 characters or fewer')
  })

  it('throws for invalid email', () => {
    expect(() =>
      validateUpdateReferrer(validId, { contactEmail: 'bad' })
    ).toThrow('Invalid email format')
  })

  it('throws for invalid commission rate', () => {
    expect(() =>
      validateUpdateReferrer(validId, { commissionPerMessageHkd: 5 })
    ).toThrow('commissionPerMessageHkd must be between 0 and 1')
  })
})

import { describe, it, expect } from 'vitest'
import { TenantValidationError } from '../create-tenant'

describe('TenantValidationError', () => {
  it('has correct name and message', () => {
    const err = new TenantValidationError('Slug is taken')
    expect(err.name).toBe('TenantValidationError')
    expect(err.message).toBe('Slug is taken')
  })

  it('is an instance of Error', () => {
    const err = new TenantValidationError('test')
    expect(err).toBeInstanceOf(Error)
  })
})

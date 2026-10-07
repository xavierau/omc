import { describe, it, expect } from 'vitest'
import { requireTenantAdmin } from '../require-tenant-admin'
import { AuthError } from '../auth-guard'

describe('requireTenantAdmin', () => {
  it('allows role admin', () => {
    expect(() => requireTenantAdmin({ role: 'admin' })).not.toThrow()
  })

  it('throws AuthError(403) for role staff', () => {
    expect(() => requireTenantAdmin({ role: 'staff' })).toThrow(AuthError)
    try {
      requireTenantAdmin({ role: 'staff' })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError)
      expect((error as AuthError).statusCode).toBe(403)
    }
  })

  it('throws AuthError(403) for an unknown future role — explicit allowlist, not a denylist', () => {
    expect(() => requireTenantAdmin({ role: 'viewer' })).toThrow(AuthError)
  })
})

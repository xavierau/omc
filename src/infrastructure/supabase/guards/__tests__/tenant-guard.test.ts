import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getTenantContext } from '../tenant-guard'
import { AuthError } from '../auth-guard'

const mockGetUser = vi.fn()
const mockSelect = vi.fn()
const mockCookieGet = vi.fn()
const mockServerSelect = vi.fn()

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => Promise.resolve({
    getAll: () => [],
    set: vi.fn(),
    get: mockCookieGet,
  })),
}))

vi.mock('../../auth-client', () => ({
  createAuthServerClient: vi.fn(() => Promise.resolve({
    auth: { getUser: mockGetUser },
    from: () => ({ select: mockSelect }),
  })),
}))

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(() => ({
    from: () => ({ select: mockServerSelect }),
  })),
}))

function mockTenantLookup(data: Record<string, unknown> | null) {
  mockSelect.mockReturnValue({
    eq: () => ({
      eq: () => ({
        single: () => Promise.resolve({
          data,
          error: data ? null : { message: 'not found' },
        }),
      }),
    }),
  })
}

function mockStatusLookup(status: string, trialExpiresAt: string | null = null) {
  mockServerSelect.mockReturnValue({
    eq: () => ({
      single: () => Promise.resolve({
        data: { status, trial_expires_at: trialExpiresAt },
        error: null,
      }),
    }),
  })
}

describe('getTenantContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'a@b.com' } },
      error: null,
    })
  })

  it('throws 403 when no tenant cookie', async () => {
    mockCookieGet.mockReturnValue(undefined)

    await expect(getTenantContext()).rejects.toThrow(AuthError)
    await expect(getTenantContext()).rejects.toMatchObject({
      statusCode: 403,
    })
  })

  it('throws 401 when user is not authenticated', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: null,
    })
    mockCookieGet.mockReturnValue({ value: 'tenant-1' })

    await expect(getTenantContext()).rejects.toThrow(AuthError)
  })

  it('returns tenant context for valid user+tenant', async () => {
    mockCookieGet.mockReturnValue({ value: 'rest-1' })
    mockTenantLookup({ restaurant_id: 'rest-1', role: 'admin' })
    mockStatusLookup('active')

    const ctx = await getTenantContext()

    expect(ctx).toEqual({
      userId: 'user-1',
      restaurantId: 'rest-1',
      role: 'admin',
      tenantStatus: 'active',
    })
  })

  it('throws 403 when tenant is inactive', async () => {
    mockCookieGet.mockReturnValue({ value: 'rest-1' })
    mockTenantLookup({ restaurant_id: 'rest-1', role: 'admin' })
    mockStatusLookup('inactive')

    await expect(getTenantContext()).rejects.toThrow(AuthError)
    await expect(getTenantContext()).rejects.toMatchObject({
      statusCode: 403,
    })
  })

  it('allows trial tenant with future expiry', async () => {
    mockCookieGet.mockReturnValue({ value: 'rest-1' })
    mockTenantLookup({ restaurant_id: 'rest-1', role: 'staff' })
    const future = new Date(Date.now() + 86400000).toISOString()
    mockStatusLookup('trial', future)

    const ctx = await getTenantContext()

    expect(ctx.tenantStatus).toBe('trial')
  })

  it('throws 403 for trial tenant with expired date', async () => {
    mockCookieGet.mockReturnValue({ value: 'rest-1' })
    mockTenantLookup({ restaurant_id: 'rest-1', role: 'admin' })
    const past = new Date(Date.now() - 86400000).toISOString()
    mockStatusLookup('trial', past)

    await expect(getTenantContext()).rejects.toThrow(AuthError)
  })
})

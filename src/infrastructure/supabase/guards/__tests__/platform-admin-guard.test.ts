import { describe, it, expect, vi, beforeEach } from 'vitest'
import { assertPlatformAdmin } from '../platform-admin-guard'
import { AuthError } from '../auth-guard'

const mockGetUser = vi.fn()
const mockSelect = vi.fn()

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => Promise.resolve({
    getAll: () => [],
    set: vi.fn(),
  })),
}))

vi.mock('../../auth-client', () => ({
  createAuthServerClient: vi.fn(() => Promise.resolve({
    auth: { getUser: mockGetUser },
    from: () => ({ select: mockSelect }),
  })),
}))

describe('assertPlatformAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'admin-1', email: 'a@b.com' } },
      error: null,
    })
  })

  it('returns userId for platform admin', async () => {
    mockSelect.mockReturnValue({
      eq: () => ({
        single: () => Promise.resolve({
          data: { id: 'row-1' },
          error: null,
        }),
      }),
    })

    const result = await assertPlatformAdmin()

    expect(result).toEqual({ userId: 'admin-1' })
  })

  it('throws 403 when not a platform admin', async () => {
    mockSelect.mockReturnValue({
      eq: () => ({
        single: () => Promise.resolve({
          data: null,
          error: { code: 'PGRST116' },
        }),
      }),
    })

    await expect(assertPlatformAdmin()).rejects.toThrow(AuthError)
    await expect(assertPlatformAdmin()).rejects.toMatchObject({
      statusCode: 403,
    })
  })

  it('throws 401 when not authenticated', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: new Error('no session'),
    })

    await expect(assertPlatformAdmin()).rejects.toThrow(AuthError)
    await expect(assertPlatformAdmin()).rejects.toMatchObject({
      statusCode: 401,
    })
  })
})

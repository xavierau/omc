import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getAuthSession, AuthError } from '../auth-guard'

const mockGetUser = vi.fn()

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => Promise.resolve({
    getAll: () => [],
    set: vi.fn(),
  })),
}))

vi.mock('../../auth-client', () => ({
  createAuthServerClient: vi.fn(() => Promise.resolve({
    auth: { getUser: mockGetUser },
  })),
}))

describe('getAuthSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns userId and email for valid session', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'a@b.com' } },
      error: null,
    })

    const session = await getAuthSession()

    expect(session).toEqual({ userId: 'user-1', email: 'a@b.com' })
  })

  it('throws AuthError 401 when no user', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    await expect(getAuthSession()).rejects.toThrow(AuthError)
    await expect(getAuthSession()).rejects.toMatchObject({
      statusCode: 401,
    })
  })

  it('throws AuthError 401 on auth error', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: new Error('invalid token'),
    })

    await expect(getAuthSession()).rejects.toThrow(AuthError)
  })

  it('defaults email to empty string if missing', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-2', email: undefined } },
      error: null,
    })

    const session = await getAuthSession()

    expect(session.email).toBe('')
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/infrastructure/supabase/repositories/member-repository')

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { findMemberByPhone } from '@/infrastructure/supabase/repositories/member-repository'
import { GET } from '../route'

const RESTAURANT_ID = 'rest-1'

function req(phone?: string): NextRequest {
  const url = phone === undefined
    ? 'http://localhost/api/dashboard/members/lookup'
    : `http://localhost/api/dashboard/members/lookup?phone=${encodeURIComponent(phone)}`
  return new NextRequest(url)
}

function tenantOk() {
  vi.mocked(getTenantContext).mockResolvedValue({
    userId: 'u-1',
    restaurantId: RESTAURANT_ID,
    role: 'admin',
    tenantStatus: 'active',
  })
}

describe('GET /api/dashboard/members/lookup', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects an unauthenticated caller', async () => {
    vi.mocked(getTenantContext).mockRejectedValue(new AuthError('Forbidden', 403))

    const res = await GET(req('85291234567'))

    expect(res.status).toBe(403)
  })

  it('returns 400 when phone is missing', async () => {
    tenantOk()

    const res = await GET(req())

    expect(res.status).toBe(400)
    expect(findMemberByPhone).not.toHaveBeenCalled()
  })

  it('resolves a member id, tenant-scoped', async () => {
    tenantOk()
    vi.mocked(findMemberByPhone).mockResolvedValue({
      id: 'm-1',
      pointsBalance: 0,
      preferredLanguage: 'en',
    })

    const res = await GET(req('85291234567'))
    const json = await res.json()

    expect(findMemberByPhone).toHaveBeenCalledWith(RESTAURANT_ID, '85291234567')
    expect(json).toEqual({ memberId: 'm-1' })
  })

  it('returns not_found when no member matches', async () => {
    tenantOk()
    vi.mocked(findMemberByPhone).mockResolvedValue(null)

    const res = await GET(req('85299999999'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ error: 'not_found' })
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/infrastructure/supabase/repositories/member-tag-repository', async () => {
  const actual = await vi.importActual<
    typeof import('@/infrastructure/supabase/repositories/member-tag-repository')
  >('@/infrastructure/supabase/repositories/member-tag-repository')
  return {
    ...actual,
    assertTagsBelongToTenant: vi.fn(),
  }
})
vi.mock('@/infrastructure/supabase/repositories/tag-audience-repository')

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import {
  assertTagsBelongToTenant,
  CrossTenantTagError,
} from '@/infrastructure/supabase/repositories/member-tag-repository'
import { countActiveMembersByTags } from '@/infrastructure/supabase/repositories/tag-audience-repository'
import { GET } from '../route'

const RESTAURANT_ID = 'rest-1'

function req(query: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/dashboard/tags/recipient-count${query}`
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getTenantContext).mockResolvedValue({
    userId: 'u-1',
    restaurantId: RESTAURANT_ID,
    role: 'admin',
    tenantStatus: 'active',
  })
  vi.mocked(assertTagsBelongToTenant).mockResolvedValue(undefined)
  vi.mocked(countActiveMembersByTags).mockResolvedValue(3)
})

describe('GET /api/dashboard/tags/recipient-count', () => {
  it('returns the count for valid tag ids', async () => {
    const r = await GET(req('?tagIds=t-1,t-2'))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ count: 3 })
    expect(assertTagsBelongToTenant).toHaveBeenCalledWith(['t-1', 't-2'], RESTAURANT_ID)
    expect(countActiveMembersByTags).toHaveBeenCalledWith(['t-1', 't-2'], RESTAURANT_ID)
  })

  it('trims whitespace and drops blanks in the comma list', async () => {
    const r = await GET(req('?tagIds=%20t-1%20,,t-2'))
    expect(r.status).toBe(200)
    expect(assertTagsBelongToTenant).toHaveBeenCalledWith(['t-1', 't-2'], RESTAURANT_ID)
  })

  it('returns 400 when tagIds is missing', async () => {
    const r = await GET(req(''))
    expect(r.status).toBe(400)
    expect(assertTagsBelongToTenant).not.toHaveBeenCalled()
  })

  it('returns 400 when tagIds is empty after trimming', async () => {
    const r = await GET(req('?tagIds=,,'))
    expect(r.status).toBe(400)
    expect(assertTagsBelongToTenant).not.toHaveBeenCalled()
  })

  it('returns 400 when more than 20 ids are given', async () => {
    const many = Array.from({ length: 21 }, (_, i) => `t-${i}`).join(',')
    const r = await GET(req(`?tagIds=${many}`))
    expect(r.status).toBe(400)
    expect(assertTagsBelongToTenant).not.toHaveBeenCalled()
  })

  it('accepts exactly 20 ids', async () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `t-${i}`).join(',')
    const r = await GET(req(`?tagIds=${twenty}`))
    expect(r.status).toBe(200)
  })

  it('returns 403 when a tag id belongs to another tenant (not a silent 0)', async () => {
    vi.mocked(assertTagsBelongToTenant).mockRejectedValueOnce(
      new CrossTenantTagError('Invalid tag IDs')
    )
    const r = await GET(req('?tagIds=t-x'))
    expect(r.status).toBe(403)
    expect(countActiveMembersByTags).not.toHaveBeenCalled()
  })

  it('returns 401 without a tenant context', async () => {
    vi.mocked(getTenantContext).mockRejectedValueOnce(new AuthError('Unauthorized', 401))
    const r = await GET(req('?tagIds=t-1'))
    expect(r.status).toBe(401)
    expect(assertTagsBelongToTenant).not.toHaveBeenCalled()
  })

  it('returns count 0 for a tag with zero members (200, not an error)', async () => {
    vi.mocked(countActiveMembersByTags).mockResolvedValueOnce(0)
    const r = await GET(req('?tagIds=t-1'))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ count: 0 })
  })
})

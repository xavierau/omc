import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/infrastructure/supabase/repositories/member-repository')

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { getMembers } from '@/infrastructure/supabase/repositories/member-repository'
import { GET, resolvePageSize } from '../route'

const RESTAURANT_ID = 'rest-1'

function req(query = ''): NextRequest {
  return new NextRequest(`http://localhost/api/dashboard/members${query}`)
}

function tenantOk() {
  vi.mocked(getTenantContext).mockResolvedValue({
    userId: 'u-1',
    restaurantId: RESTAURANT_ID,
    role: 'admin',
    tenantStatus: 'active',
  })
}

function membersOk(total = 0) {
  vi.mocked(getMembers).mockResolvedValue({ members: [], total })
}

describe('resolvePageSize', () => {
  it('defaults to MEMBERS_PAGE_SIZE when absent', () => {
    expect(resolvePageSize(null)).toBe(20)
  })

  it('defaults when non-numeric', () => {
    expect(resolvePageSize('abc')).toBe(20)
  })

  it('defaults when zero or negative', () => {
    expect(resolvePageSize('0')).toBe(20)
    expect(resolvePageSize('-5')).toBe(20)
  })

  it('honors a requested size under the cap', () => {
    expect(resolvePageSize('200')).toBe(200)
  })

  it('clamps a requested size over the cap', () => {
    expect(resolvePageSize('99999')).toBe(200)
  })
})

describe('GET /api/dashboard/members pageSize', () => {
  beforeEach(() => vi.clearAllMocks())

  it('requests MEMBERS_PAGE_SIZE from the repo when pageSize is omitted', async () => {
    tenantOk()
    membersOk()

    await GET(req())

    expect(getMembers).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 20 }))
  })

  it('requests the caller-specified pageSize, clamped to the cap', async () => {
    tenantOk()
    membersOk()

    await GET(req('?pageSize=200'))

    expect(getMembers).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 200 }))
  })

  it('clamps an over-cap pageSize request', async () => {
    tenantOk()
    membersOk()

    await GET(req('?pageSize=99999'))

    expect(getMembers).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 200 }))
  })

  it('echoes the effective pageSize and totalPages in the response', async () => {
    tenantOk()
    membersOk(43)

    const res = await GET(req('?pageSize=200'))
    const json = await res.json()

    expect(json.pageSize).toBe(200)
    expect(json.totalPages).toBe(1)
    expect(json.total).toBe(43)
  })

  it('still forwards the search term to the repo alongside pageSize', async () => {
    tenantOk()
    membersOk()

    await GET(req('?pageSize=200&search=wong'))

    expect(getMembers).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'wong', pageSize: 200 })
    )
  })
})

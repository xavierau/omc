import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/infrastructure/supabase/repositories/member-repository')
vi.mock('@/infrastructure/supabase/repositories/member-detail-repository')

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { getMembers } from '@/infrastructure/supabase/repositories/member-repository'
import { getMemberDetailForRestaurant } from '@/infrastructure/supabase/repositories/member-detail-repository'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { GET, resolvePageSize } from '../route'

const RESTAURANT_ID = 'rest-1'
const MEMBER_ID = 'member-1'

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

  it('scopes the repo query to the caller\'s tenant, regardless of pageSize', async () => {
    tenantOk()
    membersOk()

    await GET(req('?pageSize=200'))

    expect(getMembers).toHaveBeenCalledWith(expect.objectContaining({ restaurantId: RESTAURANT_ID }))
  })
})

describe('GET /api/dashboard/members?id=', () => {
  beforeEach(() => vi.clearAllMocks())

  const memberDetail = {
    id: MEMBER_ID,
    phone: '+85212345678',
    name: 'Test Member',
    points_balance: 10,
    restaurant_id: RESTAURANT_ID,
    receipts: [],
    coupons: [],
    visitCount: 0,
  }

  it("passes the caller's restaurantId to the detail lookup", async () => {
    tenantOk()
    vi.mocked(getMemberDetailForRestaurant).mockResolvedValue(memberDetail as never)

    await GET(req(`?id=${MEMBER_ID}`))

    expect(getMemberDetailForRestaurant).toHaveBeenCalledWith(MEMBER_ID, RESTAURANT_ID)
  })

  it('returns 404 when the lookup misses (foreign or missing id)', async () => {
    tenantOk()
    vi.mocked(getMemberDetailForRestaurant).mockResolvedValue(null)

    const res = await GET(req(`?id=${MEMBER_ID}`))
    const json = await res.json()

    expect(res.status).toBe(404)
    expect(json).toEqual({ error: 'Member not found' })
    expect(json).not.toHaveProperty('phone')
    expect(json).not.toHaveProperty('name')
    expect(json).not.toHaveProperty('receipts')
    expect(json).not.toHaveProperty('coupons')
  })

  it('returns 200 with the payload unchanged on the happy path', async () => {
    tenantOk()
    vi.mocked(getMemberDetailForRestaurant).mockResolvedValue(memberDetail as never)

    const res = await GET(req(`?id=${MEMBER_ID}`))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual(memberDetail)
  })

  it('never reaches the lookup when auth fails', async () => {
    vi.mocked(getTenantContext).mockRejectedValueOnce(new AuthError('Unauthorized', 401))

    const res = await GET(req(`?id=${MEMBER_ID}`))

    expect(res.status).toBe(401)
    expect(getMemberDetailForRestaurant).not.toHaveBeenCalled()
  })

  it('the route does not pre-validate id format — a repo miss answers 404 (malformed-UUID handling itself is pinned in the repository test)', async () => {
    tenantOk()
    vi.mocked(getMemberDetailForRestaurant).mockResolvedValue(null)

    const res = await GET(req('?id=not-a-uuid'))

    expect(res.status).toBe(404)
  })

  it('a repository failure answers 500, not 404', async () => {
    tenantOk()
    vi.mocked(getMemberDetailForRestaurant).mockRejectedValueOnce(new Error('db down'))

    const res = await GET(req(`?id=${MEMBER_ID}`))
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json).toEqual({ error: 'Failed to load members' })
  })

  it('?id= (empty string) falls through to the list branch, not the detail lookup', async () => {
    tenantOk()
    membersOk()

    await GET(req('?id='))

    expect(getMemberDetailForRestaurant).not.toHaveBeenCalled()
    expect(getMembers).toHaveBeenCalled()
  })
})

describe('GET /api/dashboard/members — tagId filter validation', () => {
  const TAG_ID = '11111111-1111-4111-8111-111111111111'

  beforeEach(() => {
    vi.clearAllMocks()
    tenantOk()
    membersOk()
  })

  it('passes a valid UUID tagId through to getMembers', async () => {
    const r = await GET(req(`?tagId=${TAG_ID}`))

    expect(r.status).toBe(200)
    expect(getMembers).toHaveBeenCalledWith(expect.objectContaining({ tagId: TAG_ID }))
  })

  // M-8 parity (review round 2, finding 8): an unvalidated tagId reached
  // PostgREST as `invalid input syntax for type uuid` and came back a 500.
  it('returns 400 (not 500) for a non-UUID tagId, without querying', async () => {
    const r = await GET(req('?tagId=not-a-uuid'))

    expect(r.status).toBe(400)
    expect(await r.json()).toEqual({ error: 'tagId must be a UUID' })
    expect(getMembers).not.toHaveBeenCalled()
  })

  it('leaves the filter off when tagId is absent', async () => {
    const r = await GET(req(''))

    expect(r.status).toBe(200)
    expect(getMembers).toHaveBeenCalledWith(expect.objectContaining({ tagId: undefined }))
  })
})

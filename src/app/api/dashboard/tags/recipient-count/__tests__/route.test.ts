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
import { MAX_TAG_IDS } from '../../../campaigns/parse-create-body-audience'
import { GET } from '../route'

const RESTAURANT_ID = 'rest-1'

// Real UUIDs: the route now rejects anything else with a 400 before it can
// reach PostgREST as `invalid input syntax for type uuid` (M-8).
const TAG_1 = '11111111-1111-4111-8111-111111111111'
const TAG_2 = '22222222-2222-4222-8222-222222222222'
function tagUuid(i: number): string {
  return `3${i.toString().padStart(7, '0')}-3333-4333-8333-333333333333`
}

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
    const r = await GET(req(`?tagIds=${TAG_1},${TAG_2}`))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ count: 3 })
    expect(assertTagsBelongToTenant).toHaveBeenCalledWith([TAG_1, TAG_2], RESTAURANT_ID)
    expect(countActiveMembersByTags).toHaveBeenCalledWith([TAG_1, TAG_2], RESTAURANT_ID)
  })

  it('trims whitespace and drops blanks in the comma list', async () => {
    const r = await GET(req(`?tagIds=%20${TAG_1}%20,,${TAG_2}`))
    expect(r.status).toBe(200)
    expect(assertTagsBelongToTenant).toHaveBeenCalledWith([TAG_1, TAG_2], RESTAURANT_ID)
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

  it(`returns 400 when more than MAX_TAG_IDS (${MAX_TAG_IDS}) ids are given`, async () => {
    const many = Array.from({ length: MAX_TAG_IDS + 1 }, (_, i) => tagUuid(i)).join(',')
    const r = await GET(req(`?tagIds=${many}`))
    expect(r.status).toBe(400)
    expect(assertTagsBelongToTenant).not.toHaveBeenCalled()
  })

  // The cap must equal the campaign body's cap: a lower one here 400s the live
  // count for a selection the create form accepts (review round 2, finding 4).
  it(`accepts exactly MAX_TAG_IDS (${MAX_TAG_IDS}) ids`, async () => {
    const atCap = Array.from({ length: MAX_TAG_IDS }, (_, i) => tagUuid(i)).join(',')
    const r = await GET(req(`?tagIds=${atCap}`))
    expect(r.status).toBe(200)
  })

  it('returns 400 (not 500) for a non-UUID tag id (M-8)', async () => {
    const r = await GET(req('?tagIds=not-a-uuid'))
    expect(r.status).toBe(400)
    expect(assertTagsBelongToTenant).not.toHaveBeenCalled()
    expect(countActiveMembersByTags).not.toHaveBeenCalled()
  })

  it('returns 400 when only one id in the list is malformed', async () => {
    const r = await GET(req(`?tagIds=${TAG_1},oops`))
    expect(r.status).toBe(400)
    expect(assertTagsBelongToTenant).not.toHaveBeenCalled()
  })

  it('returns 403 when a tag id belongs to another tenant (not a silent 0)', async () => {
    vi.mocked(assertTagsBelongToTenant).mockRejectedValueOnce(
      new CrossTenantTagError('Invalid tag IDs')
    )
    const r = await GET(req(`?tagIds=${TAG_1}`))
    expect(r.status).toBe(403)
    expect(countActiveMembersByTags).not.toHaveBeenCalled()
  })

  it('returns 401 without a tenant context', async () => {
    vi.mocked(getTenantContext).mockRejectedValueOnce(new AuthError('Unauthorized', 401))
    const r = await GET(req(`?tagIds=${TAG_1}`))
    expect(r.status).toBe(401)
    expect(assertTagsBelongToTenant).not.toHaveBeenCalled()
  })

  it('returns count 0 for a tag with zero members (200, not an error)', async () => {
    vi.mocked(countActiveMembersByTags).mockResolvedValueOnce(0)
    const r = await GET(req(`?tagIds=${TAG_1}`))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ count: 0 })
  })
})

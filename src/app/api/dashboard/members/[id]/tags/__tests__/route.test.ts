import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/application/list-member-tags')
vi.mock('@/application/assign-tags-to-member')
vi.mock('@/application/remove-tag-from-member')

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { listMemberTags } from '@/application/list-member-tags'
import { assignTagsToMember } from '@/application/assign-tags-to-member'
import { removeTagFromMember } from '@/application/remove-tag-from-member'
import { CrossTenantTagError } from '@/infrastructure/supabase/repositories/member-tag-repository'
import { CrossTenantMemberError } from '@/infrastructure/supabase/repositories/campaign-members-repository'
import { GET, POST } from '../route'
import { DELETE } from '../[tagId]/route'

const RESTAURANT_ID = 'rest-1'
const MEMBER_ID = 'mem-1'
const TAG = { id: 't-1', restaurantId: RESTAURANT_ID, name: 'VIP', color: '#111', createdAt: '2026-01-01T00:00:00Z' }

function params<E extends Record<string, string>>(extra: E = {} as E) {
  return { params: Promise.resolve({ id: MEMBER_ID, ...extra }) }
}

function postRequest(body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/dashboard/members/${MEMBER_ID}/tags`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getTenantContext).mockResolvedValue({
    userId: 'u-1',
    restaurantId: RESTAURANT_ID,
    role: 'admin',
    tenantStatus: 'active',
  })
  vi.mocked(listMemberTags).mockResolvedValue([TAG])
  vi.mocked(assignTagsToMember).mockResolvedValue(undefined)
  vi.mocked(removeTagFromMember).mockResolvedValue(undefined)
})

describe('GET /api/dashboard/members/[id]/tags', () => {
  it('returns the member tags scoped to the caller tenant', async () => {
    const r = await GET(new NextRequest('http://localhost/x'), params())
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ tags: [TAG] })
    expect(listMemberTags).toHaveBeenCalledWith(RESTAURANT_ID, MEMBER_ID)
  })

  it('returns 401 without a tenant context', async () => {
    vi.mocked(getTenantContext).mockRejectedValueOnce(new AuthError('Unauthorized', 401))
    const r = await GET(new NextRequest('http://localhost/x'), params())
    expect(r.status).toBe(401)
    expect(listMemberTags).not.toHaveBeenCalled()
  })
})

describe('POST /api/dashboard/members/[id]/tags', () => {
  it('assigns tags then returns the refreshed tag list', async () => {
    const r = await POST(postRequest({ tagIds: ['t-1', 't-2'] }), params())
    expect(r.status).toBe(200)
    expect(assignTagsToMember).toHaveBeenCalledWith({
      restaurantId: RESTAURANT_ID,
      memberId: MEMBER_ID,
      tagIds: ['t-1', 't-2'],
    })
    expect(await r.json()).toEqual({ tags: [TAG] })
  })

  it('returns 400 when tagIds is not an array of strings', async () => {
    const r = await POST(postRequest({ tagIds: 'nope' }), params())
    expect(r.status).toBe(400)
    expect(assignTagsToMember).not.toHaveBeenCalled()
  })

  it('returns 403 when assigning a tag from another tenant', async () => {
    vi.mocked(assignTagsToMember).mockRejectedValueOnce(new CrossTenantTagError('Invalid tag IDs'))
    const r = await POST(postRequest({ tagIds: ['t-x'] }), params())
    expect(r.status).toBe(403)
  })

  it('returns 400 when the member belongs to another tenant', async () => {
    vi.mocked(assignTagsToMember).mockRejectedValueOnce(new CrossTenantMemberError('Invalid member ID'))
    const r = await POST(postRequest({ tagIds: ['t-1'] }), params())
    expect(r.status).toBe(400)
  })
})

describe('DELETE /api/dashboard/members/[id]/tags/[tagId]', () => {
  it('removes the tag and returns success (idempotent 200)', async () => {
    const r = await DELETE(new NextRequest('http://localhost/x', { method: 'DELETE' }), params({ tagId: 't-1' }))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ success: true })
    expect(removeTagFromMember).toHaveBeenCalledWith({
      restaurantId: RESTAURANT_ID,
      memberId: MEMBER_ID,
      tagId: 't-1',
    })
  })

  it('returns 403 when removing a tag from another tenant', async () => {
    vi.mocked(removeTagFromMember).mockRejectedValueOnce(new CrossTenantTagError('Invalid tag IDs'))
    const r = await DELETE(new NextRequest('http://localhost/x', { method: 'DELETE' }), params({ tagId: 't-x' }))
    expect(r.status).toBe(403)
  })
})

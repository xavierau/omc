import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/application/bulk-update-member-tags')

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { bulkUpdateMemberTags, BulkMemberTagValidationError } from '@/application/bulk-update-member-tags'
import { CrossTenantTagError } from '@/infrastructure/supabase/repositories/member-tag-repository'
import { CrossTenantMemberError } from '@/infrastructure/supabase/repositories/campaign-members-repository'
import { POST } from '../route'

const RESTAURANT_ID = 'rest-1'

function postRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/dashboard/members/bulk-tags', {
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
  vi.mocked(bulkUpdateMemberTags).mockResolvedValue({ affected: 2 })
})

describe('POST /api/dashboard/members/bulk-tags', () => {
  it('adds tags to members and returns the affected count', async () => {
    const r = await POST(
      postRequest({ memberIds: ['m-1', 'm-2'], tagIds: ['t-1'], action: 'add' })
    )
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ affected: 2 })
    expect(bulkUpdateMemberTags).toHaveBeenCalledWith({
      restaurantId: RESTAURANT_ID,
      memberIds: ['m-1', 'm-2'],
      tagIds: ['t-1'],
      action: 'add',
    })
  })

  it('removes tags from members and returns the affected count', async () => {
    vi.mocked(bulkUpdateMemberTags).mockResolvedValueOnce({ affected: 0 })
    const r = await POST(
      postRequest({ memberIds: ['m-1'], tagIds: ['t-x'], action: 'remove' })
    )
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ affected: 0 })
  })

  it('returns 401 without a tenant context', async () => {
    vi.mocked(getTenantContext).mockRejectedValueOnce(new AuthError('Unauthorized', 401))
    const r = await POST(postRequest({ memberIds: ['m-1'], tagIds: ['t-1'], action: 'add' }))
    expect(r.status).toBe(401)
    expect(bulkUpdateMemberTags).not.toHaveBeenCalled()
  })

  it('returns 400 when memberIds is not an array of non-empty strings', async () => {
    const r = await POST(postRequest({ memberIds: 'nope', tagIds: ['t-1'], action: 'add' }))
    expect(r.status).toBe(400)
    expect(bulkUpdateMemberTags).not.toHaveBeenCalled()
  })

  it('returns 400 when memberIds contains an empty string', async () => {
    const r = await POST(postRequest({ memberIds: ['m-1', ''], tagIds: ['t-1'], action: 'add' }))
    expect(r.status).toBe(400)
    expect(bulkUpdateMemberTags).not.toHaveBeenCalled()
  })

  it('returns 400 when tagIds is not an array of strings', async () => {
    const r = await POST(postRequest({ memberIds: ['m-1'], tagIds: 'nope', action: 'add' }))
    expect(r.status).toBe(400)
    expect(bulkUpdateMemberTags).not.toHaveBeenCalled()
  })

  it('returns 400 for an unknown action', async () => {
    const r = await POST(
      postRequest({ memberIds: ['m-1'], tagIds: ['t-1'], action: 'archive' })
    )
    expect(r.status).toBe(400)
    expect(bulkUpdateMemberTags).not.toHaveBeenCalled()
  })

  it('returns 400 when the cap is exceeded', async () => {
    vi.mocked(bulkUpdateMemberTags).mockRejectedValueOnce(
      new BulkMemberTagValidationError('At most 500 members per bulk update')
    )
    const r = await POST(postRequest({ memberIds: ['m-1'], tagIds: ['t-1'], action: 'add' }))
    expect(r.status).toBe(400)
  })

  it('returns 403 when a tag belongs to another tenant', async () => {
    vi.mocked(bulkUpdateMemberTags).mockRejectedValueOnce(
      new CrossTenantTagError('Invalid tag IDs')
    )
    const r = await POST(postRequest({ memberIds: ['m-1'], tagIds: ['t-x'], action: 'add' }))
    expect(r.status).toBe(403)
  })

  it('returns the existing CrossTenantMemberError status when a member belongs to another tenant', async () => {
    vi.mocked(bulkUpdateMemberTags).mockRejectedValueOnce(
      new CrossTenantMemberError('Invalid member IDs')
    )
    const r = await POST(postRequest({ memberIds: ['m-x'], tagIds: ['t-1'], action: 'add' }))
    expect(r.status).toBe(new CrossTenantMemberError('x').statusCode)
  })
})

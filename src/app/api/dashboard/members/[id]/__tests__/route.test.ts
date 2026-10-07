import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/infrastructure/supabase/repositories/member-detail-repository')
vi.mock('@/infrastructure/supabase/repositories/member-delete-cascade')

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { getMemberDetailForRestaurant } from '@/infrastructure/supabase/repositories/member-detail-repository'
import { deleteMemberAndCascade } from '@/infrastructure/supabase/repositories/member-delete-cascade'
import { DELETE } from '../route'

const RESTAURANT_ID = 'rest-1'
const MEMBER_ID = 'mem-1'

function deleteRequest(): NextRequest {
  return new NextRequest(
    `http://localhost/api/dashboard/members/${MEMBER_ID}`,
    { method: 'DELETE' }
  )
}

function buildMember() {
  return {
    id: MEMBER_ID,
    restaurant_id: RESTAURANT_ID,
    phone: '+85291234567',
    name: 'Test',
    points_balance: 0,
    status: 'active',
    joined_at: '2026-04-20T00:00:00Z',
    last_visit_at: null,
    preferred_language: null,
    receipts: [],
    coupons: [],
    visitCount: 0,
  } as never
}

describe('DELETE /api/dashboard/members/[id]', () => {
  beforeEach(() => {
    vi.mocked(getTenantContext).mockReset()
    vi.mocked(getMemberDetailForRestaurant).mockReset()
    vi.mocked(deleteMemberAndCascade).mockReset()

    vi.mocked(getTenantContext).mockResolvedValue({
      userId: 'u-1',
      restaurantId: RESTAURANT_ID,
      role: 'admin',
      tenantStatus: 'active',
    })
    vi.mocked(getMemberDetailForRestaurant).mockResolvedValue(buildMember())
    vi.mocked(deleteMemberAndCascade).mockResolvedValue(undefined)
  })

  it('returns 401 when the caller has no auth session', async () => {
    vi.mocked(getTenantContext).mockRejectedValueOnce(
      new AuthError('Unauthorized', 401)
    )

    const r = await DELETE(deleteRequest(), {
      params: Promise.resolve({ id: MEMBER_ID }),
    })

    expect(r.status).toBe(401)
    expect(deleteMemberAndCascade).not.toHaveBeenCalled()
  })

  it('returns 404 when the member does not exist', async () => {
    vi.mocked(getMemberDetailForRestaurant).mockResolvedValueOnce(null)

    const r = await DELETE(deleteRequest(), {
      params: Promise.resolve({ id: MEMBER_ID }),
    })

    expect(r.status).toBe(404)
    expect(deleteMemberAndCascade).not.toHaveBeenCalled()
  })

  it('returns 404 when the member belongs to another tenant (the scoped lookup misses)', async () => {
    vi.mocked(getMemberDetailForRestaurant).mockResolvedValueOnce(null)

    const r = await DELETE(deleteRequest(), {
      params: Promise.resolve({ id: MEMBER_ID }),
    })

    expect(r.status).toBe(404)
    expect(await r.json()).toEqual({ error: 'Member not found' })
    expect(deleteMemberAndCascade).not.toHaveBeenCalled()
  })

  it('a lookup failure answers 500, not 404', async () => {
    vi.mocked(getMemberDetailForRestaurant).mockRejectedValueOnce(new Error('db down'))

    const r = await DELETE(deleteRequest(), {
      params: Promise.resolve({ id: MEMBER_ID }),
    })

    expect(r.status).toBe(500)
    expect(deleteMemberAndCascade).not.toHaveBeenCalled()
  })

  it("scopes the lookup to the caller's tenant", async () => {
    await DELETE(deleteRequest(), {
      params: Promise.resolve({ id: MEMBER_ID }),
    })

    expect(getMemberDetailForRestaurant).toHaveBeenCalledWith(
      MEMBER_ID,
      RESTAURANT_ID
    )
  })

  it('allows staff role (not just admin) to delete', async () => {
    vi.mocked(getTenantContext).mockResolvedValueOnce({
      userId: 'u-staff',
      restaurantId: RESTAURANT_ID,
      role: 'staff',
      tenantStatus: 'active',
    })

    const r = await DELETE(deleteRequest(), {
      params: Promise.resolve({ id: MEMBER_ID }),
    })

    expect(r.status).toBe(204)
    expect(deleteMemberAndCascade).toHaveBeenCalledWith(MEMBER_ID, RESTAURANT_ID)
  })

  it('returns 403 when the role is not admin or staff', async () => {
    vi.mocked(getTenantContext).mockResolvedValueOnce({
      userId: 'u-viewer',
      restaurantId: RESTAURANT_ID,
      role: 'viewer',
      tenantStatus: 'active',
    })

    const r = await DELETE(deleteRequest(), {
      params: Promise.resolve({ id: MEMBER_ID }),
    })

    expect(r.status).toBe(403)
    expect(deleteMemberAndCascade).not.toHaveBeenCalled()
    expect(getMemberDetailForRestaurant).not.toHaveBeenCalled()
  })

  it('returns 204 on successful delete and invokes the cascade RPC', async () => {
    const r = await DELETE(deleteRequest(), {
      params: Promise.resolve({ id: MEMBER_ID }),
    })

    expect(r.status).toBe(204)
    expect(deleteMemberAndCascade).toHaveBeenCalledTimes(1)
    expect(deleteMemberAndCascade).toHaveBeenCalledWith(MEMBER_ID, RESTAURANT_ID)
  })

  it('returns 500 when the cascade RPC throws', async () => {
    vi.mocked(deleteMemberAndCascade).mockRejectedValueOnce(
      new Error('db broke')
    )

    const r = await DELETE(deleteRequest(), {
      params: Promise.resolve({ id: MEMBER_ID }),
    })

    expect(r.status).toBe(500)
  })
})

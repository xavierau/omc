// WAQ-012: GET /api/quality/[restaurantId] — single-tenant quality detail.
// Authorization: platform admin OR a user assigned to the tenant. Anyone
// else is rejected so a tenant user cannot peek at another tenant's quality.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/platform-admin-guard')
vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/application/get-tenant-quality-overview', () => ({
  getSingleTenantQuality: vi.fn(),
}))

import { assertPlatformAdmin } from '@/infrastructure/supabase/guards/platform-admin-guard'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { getSingleTenantQuality } from '@/application/get-tenant-quality-overview'
import { GET } from '../route'

const ZERO_KPIS = {
  totalSends: 0,
  delivered: 0,
  read: 0,
  failed: 0,
  optedOut: 0,
  deliveryRate: 0,
  readRate: 0,
  errorRate: 0,
  optOutRate: 0,
}

const ROW = {
  restaurantId: 'r-1',
  restaurantName: 'Alpha',
  qualityRating: 'GREEN' as const,
  messagingTier: 'TIER_10K',
  autoPauseActive: false,
  autoPauseReason: null,
  kpis: ZERO_KPIS,
  lastTransitionedAt: '2026-05-01T00:00:00Z',
}

function req(): NextRequest {
  return new NextRequest('http://localhost/api/quality/r-1')
}

const params = Promise.resolve({ restaurantId: 'r-1' })

beforeEach(() => vi.clearAllMocks())

describe('GET /api/quality/[restaurantId]', () => {
  it('allows a platform admin to read any tenant', async () => {
    vi.mocked(assertPlatformAdmin).mockResolvedValueOnce({ userId: 'admin-1' })
    vi.mocked(getSingleTenantQuality).mockResolvedValueOnce(ROW)

    const r = await GET(req(), { params })
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.row.restaurantId).toBe('r-1')
  })

  it('allows the assigned tenant user to read their own tenant', async () => {
    vi.mocked(assertPlatformAdmin).mockRejectedValueOnce(
      new AuthError('Forbidden: not a platform admin', 403)
    )
    vi.mocked(getTenantContext).mockResolvedValueOnce({
      userId: 'user-1',
      restaurantId: 'r-1',
      role: 'admin',
      tenantStatus: 'active',
    })
    vi.mocked(getSingleTenantQuality).mockResolvedValueOnce(ROW)

    const r = await GET(req(), { params })
    expect(r.status).toBe(200)
  })

  it('rejects a tenant user trying to read a different tenant with 403', async () => {
    vi.mocked(assertPlatformAdmin).mockRejectedValueOnce(
      new AuthError('Forbidden: not a platform admin', 403)
    )
    vi.mocked(getTenantContext).mockResolvedValueOnce({
      userId: 'user-1',
      restaurantId: 'r-other', // different from path param
      role: 'admin',
      tenantStatus: 'active',
    })

    const r = await GET(req(), { params })
    expect(r.status).toBe(403)
    expect(getSingleTenantQuality).not.toHaveBeenCalled()
  })

  it('returns 401 when neither auth path succeeds (unauthenticated)', async () => {
    vi.mocked(assertPlatformAdmin).mockRejectedValueOnce(
      new AuthError('Unauthorized', 401)
    )
    vi.mocked(getTenantContext).mockRejectedValueOnce(
      new AuthError('Unauthorized', 401)
    )

    const r = await GET(req(), { params })
    expect(r.status).toBe(401)
  })

  it('returns 404 when the tenant does not exist', async () => {
    vi.mocked(assertPlatformAdmin).mockResolvedValueOnce({ userId: 'admin-1' })
    vi.mocked(getSingleTenantQuality).mockResolvedValueOnce(null)

    const r = await GET(req(), { params })
    expect(r.status).toBe(404)
  })

  it('returns 500 when the application throws', async () => {
    vi.mocked(assertPlatformAdmin).mockResolvedValueOnce({ userId: 'admin-1' })
    vi.mocked(getSingleTenantQuality).mockRejectedValueOnce(new Error('boom'))

    const r = await GET(req(), { params })
    expect(r.status).toBe(500)
  })
})

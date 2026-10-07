// WAQ-012: GET /api/admin/quality — platform-admin-only quality overview.
// Auth + rate-limit are inherited from the existing admin pattern; the test
// covers the happy path + the auth/rate-limit failure modes.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/platform-admin-guard')
vi.mock('@/infrastructure/rate-limit/admin-rate-limit')
vi.mock('@/application/get-tenant-quality-overview', () => ({
  getTenantQualityOverview: vi.fn(),
}))

import { assertPlatformAdmin } from '@/infrastructure/supabase/guards/platform-admin-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { checkAdminRateLimit } from '@/infrastructure/rate-limit/admin-rate-limit'
import { getTenantQualityOverview } from '@/application/get-tenant-quality-overview'
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

function adminReq(query = ''): NextRequest {
  return new NextRequest(`http://localhost/api/admin/quality${query}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(assertPlatformAdmin).mockResolvedValue({ userId: 'admin-1' })
  vi.mocked(checkAdminRateLimit).mockReturnValue({ success: true, remaining: 59 })
})

describe('GET /api/admin/quality', () => {
  it('returns 401 when the caller is not signed in', async () => {
    vi.mocked(assertPlatformAdmin).mockRejectedValueOnce(
      new AuthError('Unauthorized', 401)
    )
    const r = await GET(adminReq())
    expect(r.status).toBe(401)
  })

  it('returns 403 when the caller is not a platform admin', async () => {
    vi.mocked(assertPlatformAdmin).mockRejectedValueOnce(
      new AuthError('Forbidden: not a platform admin', 403)
    )
    const r = await GET(adminReq())
    expect(r.status).toBe(403)
  })

  it('returns 429 when the per-admin rate limit is exhausted', async () => {
    vi.mocked(checkAdminRateLimit).mockReturnValueOnce({
      success: false,
      remaining: 0,
    })
    const r = await GET(adminReq())
    expect(r.status).toBe(429)
  })

  it('returns the overview rows with windowDays defaulting to 7', async () => {
    vi.mocked(getTenantQualityOverview).mockResolvedValueOnce([
      {
        restaurantId: 'r-1',
        restaurantName: 'Alpha',
        qualityRating: 'GREEN',
        messagingTier: 'TIER_10K',
        autoPauseActive: false,
        autoPauseReason: null,
        kpis: ZERO_KPIS,
        lastTransitionedAt: '2026-05-01T00:00:00Z',
      },
    ])
    const r = await GET(adminReq())
    expect(r.status).toBe(200)
    expect(getTenantQualityOverview).toHaveBeenCalledWith({
      windowDays: 7,
      filterRating: undefined,
    })
    const body = await r.json()
    expect(body.rows).toHaveLength(1)
    expect(body.rows[0].restaurantId).toBe('r-1')
    expect(body.windowDays).toBe(7)
  })

  it('forwards filterRating when the caller passes ?filterRating=YELLOW', async () => {
    vi.mocked(getTenantQualityOverview).mockResolvedValueOnce([])
    await GET(adminReq('?filterRating=YELLOW'))
    expect(getTenantQualityOverview).toHaveBeenCalledWith({
      windowDays: 7,
      filterRating: 'YELLOW',
    })
  })

  it('rejects an invalid filterRating with 400', async () => {
    const r = await GET(adminReq('?filterRating=PURPLE'))
    expect(r.status).toBe(400)
    expect(getTenantQualityOverview).not.toHaveBeenCalled()
  })

  it('parses windowDays from the query string when valid', async () => {
    vi.mocked(getTenantQualityOverview).mockResolvedValueOnce([])
    await GET(adminReq('?windowDays=30'))
    expect(getTenantQualityOverview).toHaveBeenCalledWith({
      windowDays: 30,
      filterRating: undefined,
    })
  })

  it('clamps a non-positive or non-numeric windowDays to the default of 7', async () => {
    vi.mocked(getTenantQualityOverview).mockResolvedValueOnce([])
    await GET(adminReq('?windowDays=abc'))
    expect(getTenantQualityOverview).toHaveBeenCalledWith({
      windowDays: 7,
      filterRating: undefined,
    })
  })

  it('returns 500 when the application throws an unexpected error', async () => {
    vi.mocked(getTenantQualityOverview).mockRejectedValueOnce(new Error('boom'))
    const r = await GET(adminReq())
    expect(r.status).toBe(500)
  })
})

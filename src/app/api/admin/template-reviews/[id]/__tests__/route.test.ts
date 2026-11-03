import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/platform-admin-guard')
vi.mock('@/infrastructure/rate-limit/admin-rate-limit')
vi.mock('@/application/review-template', () => ({ reviewTemplate: vi.fn() }))
vi.mock('@/application/get-template-review-detail', () => ({
  getTemplateReviewDetail: vi.fn(),
}))

import { assertPlatformAdmin } from '@/infrastructure/supabase/guards/platform-admin-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { checkAdminRateLimit } from '@/infrastructure/rate-limit/admin-rate-limit'
import { getTemplateReviewDetail } from '@/application/get-template-review-detail'
import { GET } from '../route'

const REVIEW_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const mockDetail = vi.mocked(getTemplateReviewDetail)

function req(): NextRequest {
  return new NextRequest(`http://localhost/api/admin/template-reviews/${REVIEW_ID}`)
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(assertPlatformAdmin).mockResolvedValue({ userId: 'admin-1' })
  vi.mocked(checkAdminRateLimit).mockReturnValue({ success: true, remaining: 59 })
})

describe('GET /api/admin/template-reviews/[id]', () => {
  it('returns 401 when not signed in', async () => {
    vi.mocked(assertPlatformAdmin).mockRejectedValue(new AuthError('Unauthorized', 401))
    const res = await GET(req(), ctx(REVIEW_ID))
    expect(res.status).toBe(401)
    expect(mockDetail).not.toHaveBeenCalled()
  })

  it('returns 403 for a signed-in non-admin', async () => {
    vi.mocked(assertPlatformAdmin).mockRejectedValue(
      new AuthError('Forbidden: not a platform admin', 403)
    )
    const res = await GET(req(), ctx(REVIEW_ID))
    expect(res.status).toBe(403)
    expect(mockDetail).not.toHaveBeenCalled()
  })

  it('returns 429 when rate limited', async () => {
    vi.mocked(checkAdminRateLimit).mockReturnValue({ success: false, remaining: 0 })
    const res = await GET(req(), ctx(REVIEW_ID))
    expect(res.status).toBe(429)
  })

  it('returns 400 for a malformed review id', async () => {
    const res = await GET(req(), ctx('not-a-uuid'))
    expect(res.status).toBe(400)
    expect(mockDetail).not.toHaveBeenCalled()
  })

  it('returns 404 for an unknown review', async () => {
    mockDetail.mockResolvedValue(null)
    const res = await GET(req(), ctx(REVIEW_ID))
    expect(res.status).toBe(404)
    expect(mockDetail).toHaveBeenCalledWith(REVIEW_ID)
  })

  it('returns 200 with the detail shape', async () => {
    const detail = {
      review: { id: REVIEW_ID, templateName: 'nov_promo_2026' },
      restaurant: { id: 'r-1', name: 'Bicho' },
      submitterEmail: 'owner@bicho.hk',
      template: { id: 't-1', name: 'nov_promo_2026', language: 'zh_HK', category: 'MARKETING', status: 'pending', components: [] },
      campaigns: [{ id: 'c-1', audienceSize: 42 }],
    }
    mockDetail.mockResolvedValue(detail as never)

    const res = await GET(req(), ctx(REVIEW_ID))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(detail)
  })

  it('returns 500 without leaking internals when the use case throws', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockDetail.mockRejectedValue(new Error('db exploded: secret detail'))
    const res = await GET(req(), ctx(REVIEW_ID))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal server error' })
    err.mockRestore()
  })
})

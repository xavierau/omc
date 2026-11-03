import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/platform-admin-guard')
vi.mock('@/infrastructure/rate-limit/admin-rate-limit')
vi.mock('@/infrastructure/supabase/repositories/template-review-repository', () => ({
  listTemplateReviewsByStatus: vi.fn(),
}))
vi.mock('@/application/get-template-review-detail', () => ({
  enrichTemplateReviews: vi.fn(),
}))

import { assertPlatformAdmin } from '@/infrastructure/supabase/guards/platform-admin-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { checkAdminRateLimit } from '@/infrastructure/rate-limit/admin-rate-limit'
import { listTemplateReviewsByStatus } from '@/infrastructure/supabase/repositories/template-review-repository'
import { enrichTemplateReviews } from '@/application/get-template-review-detail'
import { TemplateReview, type TemplateReviewProps } from '@/domain/entities/template-review'
import { GET } from '../route'

function props(id: string): TemplateReviewProps {
  return {
    id,
    restaurantId: 'r-1',
    templateId: null,
    templateName: 'nov_promo_2026',
    targetAudienceSize: null,
    targetAudienceQuery: null,
    contentPreview: null,
    status: 'pending',
    submittedBy: 'u-1',
    submittedAt: '2026-11-01T00:00:00Z',
    reviewedBy: null,
    reviewedAt: null,
    reviewNotes: null,
  }
}

function req(query = ''): NextRequest {
  return new NextRequest(`http://localhost/api/admin/template-reviews${query}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(assertPlatformAdmin).mockResolvedValue({ userId: 'admin-1' })
  vi.mocked(checkAdminRateLimit).mockReturnValue({ success: true, remaining: 59 })
})

describe('GET /api/admin/template-reviews', () => {
  it('returns rows carrying restaurantName and submitterEmail', async () => {
    vi.mocked(listTemplateReviewsByStatus).mockResolvedValue([
      TemplateReview.fromProps(props('rev-1')),
    ])
    vi.mocked(enrichTemplateReviews).mockImplementation(async (rows) =>
      rows.map((r) => ({ ...r, restaurantName: 'Bicho', submitterEmail: 'owner@bicho.hk' }))
    )

    const res = await GET(req())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(listTemplateReviewsByStatus).toHaveBeenCalledWith({ status: 'pending' })
    expect(enrichTemplateReviews).toHaveBeenCalledWith([props('rev-1')])
    expect(body.reviews).toEqual([
      { ...props('rev-1'), restaurantName: 'Bicho', submitterEmail: 'owner@bicho.hk' },
    ])
  })

  it('returns 400 for an unknown status', async () => {
    const res = await GET(req('?status=bogus'))
    expect(res.status).toBe(400)
  })

  it('returns 403 for a non-admin', async () => {
    vi.mocked(assertPlatformAdmin).mockRejectedValue(new AuthError('Forbidden', 403))
    const res = await GET(req())
    expect(res.status).toBe(403)
    expect(listTemplateReviewsByStatus).not.toHaveBeenCalled()
  })
})

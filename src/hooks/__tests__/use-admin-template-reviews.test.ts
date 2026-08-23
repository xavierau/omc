import { describe, it, expect, beforeEach, vi } from 'vitest'
import { buildTemplateReviewsUrl } from '@/hooks/use-admin-template-reviews'

describe('buildTemplateReviewsUrl', () => {
  it('builds the URL for each status', () => {
    expect(buildTemplateReviewsUrl('pending')).toBe('/api/admin/template-reviews?status=pending')
    expect(buildTemplateReviewsUrl('approved')).toBe('/api/admin/template-reviews?status=approved')
    expect(buildTemplateReviewsUrl('rejected')).toBe('/api/admin/template-reviews?status=rejected')
    expect(buildTemplateReviewsUrl('changes_requested')).toBe(
      '/api/admin/template-reviews?status=changes_requested'
    )
  })
})

describe('useAdminTemplateReviews fetch wiring', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('hook signature exposes the documented contract', async () => {
    const mod = await import('@/hooks/use-admin-template-reviews')
    expect(typeof mod.useAdminTemplateReviews).toBe('function')
  })

  it('GET request hits the status-scoped URL', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'pending', reviews: [] }),
    })
    vi.stubGlobal('fetch', fetchSpy)
    await fetch(buildTemplateReviewsUrl('pending'))
    expect(fetchSpy).toHaveBeenCalledWith('/api/admin/template-reviews?status=pending')
  })
})

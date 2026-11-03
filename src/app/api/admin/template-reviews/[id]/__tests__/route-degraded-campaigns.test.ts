// WAQ-011-DETAIL r2 (R2-4/R2-6): a failed campaign listing must not take the
// review panel down. Real getTemplateReviewDetail; only the repositories fail.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/platform-admin-guard')
vi.mock('@/infrastructure/rate-limit/admin-rate-limit')
vi.mock('@/infrastructure/supabase/client', () => ({ createServerSupabaseClient: vi.fn() }))
vi.mock('@/infrastructure/supabase/repositories/template-review-repository', () => ({
  findTemplateReviewById: vi.fn(),
  listTemplateReviewsByStatus: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/whatsapp-template-repository', () => ({
  findByIdForRestaurant: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/template-review-detail-queries', () => ({
  findLatestTemplateByNameForRestaurant: vi.fn(),
  listCampaignsUsingTemplate: vi.fn(),
  countCampaignMembers: vi.fn(),
}))

import { assertPlatformAdmin } from '@/infrastructure/supabase/guards/platform-admin-guard'
import { checkAdminRateLimit } from '@/infrastructure/rate-limit/admin-rate-limit'
import { findTemplateReviewById } from '@/infrastructure/supabase/repositories/template-review-repository'
import { findByIdForRestaurant } from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { listCampaignsUsingTemplate } from '@/infrastructure/supabase/repositories/template-review-detail-queries'
import { TemplateReview } from '@/domain/entities/template-review'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import { GET } from '../route'

const REVIEW_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const RESTAURANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const template = {
  id: 'tpl-1',
  restaurantId: RESTAURANT,
  metaTemplateId: null,
  name: 'nov_promo_2026',
  language: 'zh_HK',
  category: 'MARKETING',
  status: 'approved',
  components: [{ type: 'BODY', text: 'Body' }],
  parameterFormat: 'NAMED',
  rejectionReason: null,
  createdAt: '2026-10-30T00:00:00Z',
  updatedAt: '2026-10-31T00:00:00Z',
} as WhatsAppTemplate

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(assertPlatformAdmin).mockResolvedValue({ userId: 'admin-1' })
  vi.mocked(checkAdminRateLimit).mockReturnValue({ success: true, remaining: 59 })
  vi.mocked(findTemplateReviewById).mockResolvedValue(
    TemplateReview.fromProps({
      id: REVIEW_ID,
      restaurantId: RESTAURANT,
      templateId: 'tpl-1',
      templateName: 'nov_promo_2026',
      targetAudienceSize: null,
      targetAudienceQuery: null,
      contentPreview: 'Hello',
      status: 'pending',
      submittedBy: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      submittedAt: '2026-11-01T00:00:00Z',
      reviewedBy: null,
      reviewedAt: null,
      reviewNotes: null,
    })
  )
  vi.mocked(findByIdForRestaurant).mockResolvedValue(template)
})

describe('GET /api/admin/template-reviews/[id] — degraded campaigns', () => {
  it('returns 200 with campaigns null + campaignsError when listing campaigns throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(listCampaignsUsingTemplate).mockRejectedValue(new Error('campaigns: relation unavailable'))

    const res = await GET(
      new NextRequest(`http://localhost/api/admin/template-reviews/${REVIEW_ID}`),
      { params: Promise.resolve({ id: REVIEW_ID }) }
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.template.id).toBe('tpl-1')
    expect(body.campaigns).toBeNull()
    expect(body.campaignsError).toBe(true)
    expect(body).not.toHaveProperty('restaurant')
    expect(body).not.toHaveProperty('submitterEmail')
    expect(body).not.toHaveProperty('templateMissing')
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})

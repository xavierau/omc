import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildCampaign, buildWhatsAppTemplate } from '@/test-utils/builders'
import { TemplateReview } from '@/domain/entities/template-review'

// Issue #102 fix 4: per-campaign template-review state for the dashboard
// campaigns API, so the UI can explain a disabled Send button instead of
// failing silently. N+1 ZERO TOLERANCE: this must issue a FIXED number of
// queries regardless of how many campaigns are in the list.

vi.mock('@/application/check-tenant-trust', () => ({
  isTenantTrusted: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/whatsapp-template-repository', () => ({
  findManyByIdsForRestaurant: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/template-review-repository', () => ({
  findLatestTemplateReviewsByNames: vi.fn(),
}))

import { buildCampaignTemplateReviewStates } from '../build-campaign-template-review-states'
import { isTenantTrusted } from '@/application/check-tenant-trust'
import { findManyByIdsForRestaurant } from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { findLatestTemplateReviewsByNames } from '@/infrastructure/supabase/repositories/template-review-repository'

const RESTAURANT_ID = 'rest-1'

function review(overrides: {
  templateName: string
  status: 'pending' | 'approved' | 'rejected' | 'changes_requested'
}): TemplateReview {
  const submitted = TemplateReview.submit({
    id: `rev-${overrides.templateName}`,
    restaurantId: RESTAURANT_ID,
    templateName: overrides.templateName,
    submittedBy: 'tenant-user-1',
  })
  if (overrides.status === 'pending') return submitted
  if (overrides.status === 'approved') return submitted.approve('admin-1')
  if (overrides.status === 'rejected') return submitted.reject('admin-1', 'no')
  return submitted.requestChanges('admin-1', 'fix copy')
}

describe('buildCampaignTemplateReviewStates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isTenantTrusted).mockResolvedValue({ trusted: false, reason: 'too_new' })
    vi.mocked(findManyByIdsForRestaurant).mockResolvedValue([])
    vi.mocked(findLatestTemplateReviewsByNames).mockResolvedValue([])
  })

  it('returns an empty map without querying anything when no campaign has a whatsappTemplateId', async () => {
    const campaigns = [buildCampaign({ id: 'c-1', whatsappTemplateId: null })]

    const result = await buildCampaignTemplateReviewStates(RESTAURANT_ID, campaigns)

    expect(result.size).toBe(0)
    expect(findManyByIdsForRestaurant).not.toHaveBeenCalled()
    expect(isTenantTrusted).not.toHaveBeenCalled()
  })

  it('skips campaigns whose template is UTILITY (not MARKETING) and skips the trust/review queries', async () => {
    const campaigns = [buildCampaign({ id: 'c-1', whatsappTemplateId: 'tpl-1' })]
    vi.mocked(findManyByIdsForRestaurant).mockResolvedValue([
      buildWhatsAppTemplate({ id: 'tpl-1', name: 'receipt_ack', category: 'UTILITY' }),
    ])

    const result = await buildCampaignTemplateReviewStates(RESTAURANT_ID, campaigns)

    expect(result.size).toBe(0)
    expect(isTenantTrusted).not.toHaveBeenCalled()
    expect(findLatestTemplateReviewsByNames).not.toHaveBeenCalled()
  })

  it('reports status=none when a MARKETING template has no review row', async () => {
    const campaigns = [buildCampaign({ id: 'c-1', whatsappTemplateId: 'tpl-1' })]
    vi.mocked(findManyByIdsForRestaurant).mockResolvedValue([
      buildWhatsAppTemplate({ id: 'tpl-1', name: 'promo_a', category: 'MARKETING' }),
    ])
    vi.mocked(isTenantTrusted).mockResolvedValue({ trusted: false, reason: 'too_new' })

    const result = await buildCampaignTemplateReviewStates(RESTAURANT_ID, campaigns)

    expect(result.get('c-1')).toEqual({ required: true, status: 'none' })
  })

  it('reports the review row status and required=false when the tenant is trusted', async () => {
    const campaigns = [buildCampaign({ id: 'c-1', whatsappTemplateId: 'tpl-1' })]
    vi.mocked(findManyByIdsForRestaurant).mockResolvedValue([
      buildWhatsAppTemplate({ id: 'tpl-1', name: 'promo_a', category: 'MARKETING' }),
    ])
    vi.mocked(isTenantTrusted).mockResolvedValue({ trusted: true })
    vi.mocked(findLatestTemplateReviewsByNames).mockResolvedValue([
      review({ templateName: 'promo_a', status: 'approved' }),
    ])

    const result = await buildCampaignTemplateReviewStates(RESTAURANT_ID, campaigns)

    expect(result.get('c-1')).toEqual({ required: false, status: 'approved' })
  })

  it('surfaces a rejected review (not "none") so the UI can explain the block', async () => {
    const campaigns = [buildCampaign({ id: 'c-1', whatsappTemplateId: 'tpl-1' })]
    vi.mocked(findManyByIdsForRestaurant).mockResolvedValue([
      buildWhatsAppTemplate({ id: 'tpl-1', name: 'promo_a', category: 'MARKETING' }),
    ])
    vi.mocked(isTenantTrusted).mockResolvedValue({ trusted: false, reason: 'too_new' })
    vi.mocked(findLatestTemplateReviewsByNames).mockResolvedValue([
      review({ templateName: 'promo_a', status: 'rejected' }),
    ])

    const result = await buildCampaignTemplateReviewStates(RESTAURANT_ID, campaigns)

    expect(result.get('c-1')).toEqual({ required: true, status: 'rejected' })
  })

  it('omits campaigns with no whatsappTemplateId from the result map', async () => {
    const campaigns = [
      buildCampaign({ id: 'c-1', whatsappTemplateId: 'tpl-1' }),
      buildCampaign({ id: 'c-2', whatsappTemplateId: null }),
    ]
    vi.mocked(findManyByIdsForRestaurant).mockResolvedValue([
      buildWhatsAppTemplate({ id: 'tpl-1', name: 'promo_a', category: 'MARKETING' }),
    ])

    const result = await buildCampaignTemplateReviewStates(RESTAURANT_ID, campaigns)

    expect(result.has('c-1')).toBe(true)
    expect(result.has('c-2')).toBe(false)
  })

  // N+1 ZERO TOLERANCE: query counts must stay fixed regardless of list size.
  it('issues exactly ONE trust check, ONE template batch fetch, and ONE review batch fetch for many campaigns sharing templates', async () => {
    const campaigns = [
      buildCampaign({ id: 'c-1', whatsappTemplateId: 'tpl-1' }),
      buildCampaign({ id: 'c-2', whatsappTemplateId: 'tpl-1' }), // same template
      buildCampaign({ id: 'c-3', whatsappTemplateId: 'tpl-2' }),
      buildCampaign({ id: 'c-4', whatsappTemplateId: null }), // inline, no template
    ]
    vi.mocked(findManyByIdsForRestaurant).mockResolvedValue([
      buildWhatsAppTemplate({ id: 'tpl-1', name: 'promo_a', category: 'MARKETING' }),
      buildWhatsAppTemplate({ id: 'tpl-2', name: 'promo_b', category: 'MARKETING' }),
    ])
    vi.mocked(isTenantTrusted).mockResolvedValue({ trusted: false, reason: 'too_new' })

    const result = await buildCampaignTemplateReviewStates(RESTAURANT_ID, campaigns)

    expect(isTenantTrusted).toHaveBeenCalledTimes(1)
    expect(findManyByIdsForRestaurant).toHaveBeenCalledTimes(1)
    expect(findManyByIdsForRestaurant).toHaveBeenCalledWith(['tpl-1', 'tpl-2'], RESTAURANT_ID)
    expect(findLatestTemplateReviewsByNames).toHaveBeenCalledTimes(1)
    expect(findLatestTemplateReviewsByNames).toHaveBeenCalledWith({
      restaurantId: RESTAURANT_ID,
      templateNames: ['promo_a', 'promo_b'],
    })
    expect(result.size).toBe(3)
  })
})

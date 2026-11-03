import { describe, it, expect, vi } from 'vitest'

vi.mock('@/infrastructure/supabase/client')

import {
  getTemplateReviewDetail,
  enrichTemplateReviews,
  type TemplateReviewDetailDeps,
} from '../get-template-review-detail'
import { TemplateReview, type TemplateReviewProps } from '@/domain/entities/template-review'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import type { TemplateCampaignRow } from '@/infrastructure/supabase/repositories/template-review-detail-queries'

const RESTAURANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SUBMITTER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function reviewProps(overrides: Partial<TemplateReviewProps> = {}): TemplateReviewProps {
  return {
    id: 'rev-1',
    restaurantId: RESTAURANT,
    templateId: 'tpl-1',
    templateName: 'nov_promo_2026',
    targetAudienceSize: null,
    targetAudienceQuery: null,
    contentPreview: 'Hello',
    status: 'pending',
    submittedBy: SUBMITTER,
    submittedAt: '2026-11-01T00:00:00Z',
    reviewedBy: null,
    reviewedAt: null,
    reviewNotes: null,
    ...overrides,
  }
}

function template(overrides: Partial<WhatsAppTemplate> = {}): WhatsAppTemplate {
  return {
    id: 'tpl-1',
    restaurantId: RESTAURANT,
    metaTemplateId: null,
    name: 'nov_promo_2026',
    language: 'zh_HK',
    category: 'MARKETING',
    status: 'pending',
    components: [
      { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['https://x.supabase.co/a.jpg'] } },
      { type: 'BODY', text: 'Body' },
    ],
    parameterFormat: 'NAMED',
    rejectionReason: null,
    createdAt: '2026-10-30T00:00:00Z',
    updatedAt: '2026-10-31T00:00:00Z',
    ...overrides,
  }
}

function campaign(overrides: Partial<TemplateCampaignRow> = {}): TemplateCampaignRow {
  return {
    id: 'camp-1',
    name: 'November promo',
    type: 'promo',
    status: 'draft',
    targetAudience: 'tag',
    couponConfig: { discountType: 'percentage', discountValue: 20, expiresInDays: 14 },
    scheduledAt: null,
    schedule: null,
    createdAt: '2026-10-31T00:00:00Z',
    ...overrides,
  }
}

function deps(overrides: Partial<TemplateReviewDetailDeps> = {}): TemplateReviewDetailDeps {
  return {
    findReviewById: vi.fn(async () => TemplateReview.fromProps(reviewProps())),
    findRestaurantNames: vi.fn(async () => new Map([[RESTAURANT, 'Bicho']])),
    findUserEmails: vi.fn(async () => new Map([[SUBMITTER, 'owner@bicho.hk']])),
    findTemplateById: vi.fn(async () => template()),
    findLatestTemplateByName: vi.fn(async () => null),
    listCampaignsUsingTemplate: vi.fn(async () => [campaign()]),
    getCampaignTagIds: vi.fn(async () => ['tag-1', 'tag-2']),
    countActiveMembersByTags: vi.fn(async () => 42),
    countCampaignMembers: vi.fn(async () => 7),
    ...overrides,
  }
}

describe('getTemplateReviewDetail', () => {
  it('returns null for an unknown review', async () => {
    const d = deps({ findReviewById: vi.fn(async () => null) })
    expect(await getTemplateReviewDetail('missing', d)).toBeNull()
    expect(d.findTemplateById).not.toHaveBeenCalled()
  })

  it('resolves the template by the review templateId, scoped to the restaurant', async () => {
    const d = deps()
    const detail = await getTemplateReviewDetail('rev-1', d)

    expect(d.findTemplateById).toHaveBeenCalledWith('tpl-1', RESTAURANT)
    expect(d.findLatestTemplateByName).not.toHaveBeenCalled()
    expect(detail?.template).toEqual({
      id: 'tpl-1',
      name: 'nov_promo_2026',
      language: 'zh_HK',
      category: 'MARKETING',
      status: 'pending',
      components: template().components,
    })
  })

  it('falls back to the latest template by (restaurant, name) only when the review has no templateId', async () => {
    // The review snapshot carries no language (template_review_queue has no
    // language column), so the name fallback is latest-by-name.
    const d = deps({
      findReviewById: vi.fn(async () => TemplateReview.fromProps(reviewProps({ templateId: null }))),
      findLatestTemplateByName: vi.fn(async () => template({ id: 'tpl-by-name' })),
    })
    const detail = await getTemplateReviewDetail('rev-1', d)

    expect(d.findTemplateById).not.toHaveBeenCalled()
    expect(d.findLatestTemplateByName).toHaveBeenCalledWith(RESTAURANT, 'nov_promo_2026')
    expect(detail?.template?.id).toBe('tpl-by-name')
    expect(detail?.templateMissing).toBe(false)
    expect(d.listCampaignsUsingTemplate).toHaveBeenCalledWith(RESTAURANT, 'tpl-by-name')
  })

  it('never falls back by name when the templateId is set but no longer resolves — flags templateMissing', async () => {
    const d = deps({
      findTemplateById: vi.fn(async () => null),
      findLatestTemplateByName: vi.fn(async () => template({ id: 'tpl-2' })),
    })
    const detail = await getTemplateReviewDetail('rev-1', d)

    expect(d.findLatestTemplateByName).not.toHaveBeenCalled()
    expect(detail?.template).toBeNull()
    expect(detail?.templateMissing).toBe(true)
    expect(detail?.campaigns).toEqual([])
    expect(d.listCampaignsUsingTemplate).not.toHaveBeenCalled()
  })

  it('flags templateMissing when the name fallback finds nothing either', async () => {
    const d = deps({
      findReviewById: vi.fn(async () => TemplateReview.fromProps(reviewProps({ templateId: null }))),
      findLatestTemplateByName: vi.fn(async () => null),
    })
    const detail = await getTemplateReviewDetail('rev-1', d)

    expect(detail?.template).toBeNull()
    expect(detail?.templateMissing).toBe(true)
    expect(d.listCampaignsUsingTemplate).not.toHaveBeenCalled()
  })

  it('reports templateMissing false when the review templateId resolves', async () => {
    const detail = await getTemplateReviewDetail('rev-1', deps())
    expect(detail?.templateMissing).toBe(false)
  })

  it('returns restaurant name and submitter email instead of bare ids', async () => {
    const d = deps()
    const detail = await getTemplateReviewDetail('rev-1', d)

    expect(detail?.restaurant).toEqual({ id: RESTAURANT, name: 'Bicho' })
    expect(detail?.submitterEmail).toBe('owner@bicho.hk')
    expect(d.findUserEmails).toHaveBeenCalledTimes(1)
    expect(detail?.review.id).toBe('rev-1')
  })

  it('returns campaigns with coupon config and a tag audience size', async () => {
    const d = deps()
    const detail = await getTemplateReviewDetail('rev-1', d)

    expect(d.getCampaignTagIds).toHaveBeenCalledWith('camp-1')
    expect(d.countActiveMembersByTags).toHaveBeenCalledWith(['tag-1', 'tag-2'], RESTAURANT)
    expect(detail?.campaigns).toEqual([
      { ...campaign(), audienceSize: 42 },
    ])
  })

  it('sizes a selected audience by its member count and leaves "all" unknown', async () => {
    const d = deps({
      listCampaignsUsingTemplate: vi.fn(async () => [
        campaign({ id: 'sel', targetAudience: 'selected', couponConfig: null }),
        campaign({ id: 'all', targetAudience: 'all', scheduledAt: '2026-11-10T02:00:00Z' }),
      ]),
    })
    const detail = await getTemplateReviewDetail('rev-1', d)

    expect(d.countCampaignMembers).toHaveBeenCalledWith('sel')
    expect(detail?.campaigns.map((c) => [c.id, c.audienceSize, c.couponConfig])).toEqual([
      ['sel', 7, null],
      ['all', null, campaign().couponConfig],
    ])
  })

  it('degrades a failed audience count to null instead of failing the panel', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const d = deps({ getCampaignTagIds: vi.fn(async () => { throw new Error('no campaign_tags') }) })
    const detail = await getTemplateReviewDetail('rev-1', d)

    expect(detail?.campaigns[0].audienceSize).toBeNull()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('skips the email lookup for a legacy "unknown" submitter', async () => {
    const d = deps({
      findReviewById: vi.fn(async () => TemplateReview.fromProps(reviewProps({ submittedBy: 'unknown' }))),
    })
    const detail = await getTemplateReviewDetail('rev-1', d)
    expect(d.findUserEmails).not.toHaveBeenCalled()
    expect(detail?.submitterEmail).toBeNull()
  })
})

describe('enrichTemplateReviews', () => {
  it('adds restaurantName and submitterEmail with one restaurant query and ONE user listing per request', async () => {
    const other = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    const d = deps({
      findRestaurantNames: vi.fn(async () => new Map([[RESTAURANT, 'Bicho']])),
      findUserEmails: vi.fn(async () => new Map([[SUBMITTER, 'owner@bicho.hk']])),
    })
    const rows = await enrichTemplateReviews(
      [
        reviewProps({ id: 'r1' }),
        reviewProps({ id: 'r2' }),
        reviewProps({ id: 'r3', restaurantId: other, submittedBy: other }),
      ],
      d
    )

    expect(d.findRestaurantNames).toHaveBeenCalledTimes(1)
    expect(d.findRestaurantNames).toHaveBeenCalledWith([RESTAURANT, other])
    expect(d.findUserEmails).toHaveBeenCalledTimes(1)
    expect(rows.map((r) => [r.id, r.restaurantName, r.submitterEmail])).toEqual([
      ['r1', 'Bicho', 'owner@bicho.hk'],
      ['r2', 'Bicho', 'owner@bicho.hk'],
      ['r3', null, null],
    ])
  })

  it('leaves names and emails null when both lookups come back empty (degraded)', async () => {
    const d = deps({
      findRestaurantNames: vi.fn(async () => new Map()),
      findUserEmails: vi.fn(async () => new Map()),
    })
    const [row] = await enrichTemplateReviews([reviewProps()], d)
    expect([row.restaurantName, row.submitterEmail]).toEqual([null, null])
  })

  it('makes no lookups for an empty list', async () => {
    const d = deps()
    expect(await enrichTemplateReviews([], d)).toEqual([])
    expect(d.findRestaurantNames).not.toHaveBeenCalled()
  })
})

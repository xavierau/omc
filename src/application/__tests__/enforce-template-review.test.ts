import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Campaign } from '@/domain/entities/campaign'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'

vi.mock('../check-template-review', () => ({
  checkTemplateReview: vi.fn(),
}))

import { enforceTemplateReview } from '../enforce-template-review'
import { checkTemplateReview } from '../check-template-review'
import { CampaignGuardrailError } from '../campaign-guardrail-error'

const mockCheck = vi.mocked(checkTemplateReview)

const CAMPAIGN = { id: 'camp-1' } as Campaign

function makeTemplate(
  overrides: Partial<WhatsAppTemplate> = {}
): WhatsAppTemplate {
  return {
    id: 'tmpl-1',
    restaurantId: 'rest-1',
    metaTemplateId: null,
    name: 'promo_summer',
    language: 'en',
    category: 'MARKETING',
    status: 'approved',
    components: [],
    parameterFormat: 'NAMED',
    rejectionReason: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}

beforeEach(() => vi.clearAllMocks())

describe('enforceTemplateReview', () => {
  it('passes silently for null template (inline-only campaign)', async () => {
    await expect(
      enforceTemplateReview({
        campaign: CAMPAIGN,
        restaurantId: 'rest-1',
        template: null,
      })
    ).resolves.toBeUndefined()
    expect(mockCheck).not.toHaveBeenCalled()
  })

  it('passes silently for UTILITY templates', async () => {
    await expect(
      enforceTemplateReview({
        campaign: CAMPAIGN,
        restaurantId: 'rest-1',
        template: makeTemplate({ category: 'UTILITY' }),
      })
    ).resolves.toBeUndefined()
    expect(mockCheck).not.toHaveBeenCalled()
  })

  it('passes when checkTemplateReview allows the send (trusted/approved)', async () => {
    mockCheck.mockResolvedValue({ allowed: true })
    await expect(
      enforceTemplateReview({
        campaign: CAMPAIGN,
        restaurantId: 'rest-1',
        template: makeTemplate(),
      })
    ).resolves.toBeUndefined()
    expect(mockCheck).toHaveBeenCalledWith({
      restaurantId: 'rest-1',
      templateName: 'promo_summer',
    })
  })

  it('throws CampaignGuardrailError when the gate denies', async () => {
    mockCheck.mockResolvedValue({
      allowed: false,
      reason: 'template_review_required',
      trustReason: 'too_new',
    })
    await expect(
      enforceTemplateReview({
        campaign: CAMPAIGN,
        restaurantId: 'rest-1',
        template: makeTemplate(),
      })
    ).rejects.toBeInstanceOf(CampaignGuardrailError)
  })

  it('error message mentions the template name and campaign id', async () => {
    mockCheck.mockResolvedValue({
      allowed: false,
      reason: 'template_review_required',
    })
    try {
      await enforceTemplateReview({
        campaign: CAMPAIGN,
        restaurantId: 'rest-1',
        template: makeTemplate({ name: 'spring_blast' }),
      })
      throw new Error('expected throw')
    } catch (err) {
      const violations = (err as CampaignGuardrailError).violations
      expect(violations[0]).toContain('spring_blast')
      expect(violations[0]).toContain('camp-1')
    }
  })
})

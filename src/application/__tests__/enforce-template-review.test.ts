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

  // WAQ-014: the gate's own decision (trustReason) must be rendered into the
  // thrown message, naming the real cause/approver instead of the generic
  // "platform approval" text that sent everyone diagnosing Meta/Kapso.
  const TRUST_REASON_CASES = [
    {
      trustReason: 'too_new' as const,
      tokenSubstring: 'trustReason=too_new',
      causeSubstring: 'less than 90 days old',
    },
    {
      trustReason: 'recent_quality_incident' as const,
      tokenSubstring: 'trustReason=recent_quality_incident',
      causeSubstring: 'quality-rating incident',
    },
    {
      trustReason: 'auto_paused' as const,
      tokenSubstring: 'trustReason=auto_paused',
      causeSubstring: 'auto-paused',
    },
    {
      trustReason: undefined,
      tokenSubstring: 'trustReason=unspecified',
      causeSubstring: 'not yet trusted',
    },
  ]

  describe.each(TRUST_REASON_CASES)(
    'trustReason=$trustReason',
    ({ trustReason, tokenSubstring, causeSubstring }) => {
      it('names the cause, disclaims Meta, and points at the fix path', async () => {
        mockCheck.mockResolvedValue({
          allowed: false,
          reason: 'template_review_required',
          trustReason,
        })
        try {
          await enforceTemplateReview({
            campaign: CAMPAIGN,
            restaurantId: 'rest-1',
            template: makeTemplate(),
          })
          throw new Error('expected throw')
        } catch (err) {
          expect(err).toBeInstanceOf(CampaignGuardrailError)
          const violations = (err as CampaignGuardrailError).violations
          expect(violations[0]).toContain(tokenSubstring)
          expect(violations[0]).toContain(causeSubstring)
          expect(violations[0]).toContain('OhMyClient')
          expect(violations[0]).toContain('NOT WhatsApp/Meta template approval')
          expect(violations[0]).toContain('Meta is not consulted')
          expect(violations[0]).toContain('/dashboard/wa-templates')
          expect(violations[0]).toContain('/admin/template-reviews')
        }
      })
    }
  )

  it("stays inside the queue's 500-char failure_reason cap for every trustReason", async () => {
    // Mirrors FAILURE_REASON_MAX_LEN in src/infrastructure/queue/campaign-queue.ts —
    // the queue worker truncates campaigns.failure_reason at 500 chars, so
    // err.message must never exceed that or the Meta-disambiguation clause
    // (deliberately placed first) risks being chopped by a future edit.
    const longName = 'a'.repeat(200)
    const uuidCampaignId = '123e4567-e89b-12d3-a456-426614174000'
    const longCampaign = { id: uuidCampaignId } as Campaign

    for (const { trustReason } of TRUST_REASON_CASES) {
      mockCheck.mockResolvedValue({
        allowed: false,
        reason: 'template_review_required',
        trustReason,
      })
      try {
        await enforceTemplateReview({
          campaign: longCampaign,
          restaurantId: 'rest-1',
          template: makeTemplate({ name: longName }),
        })
        throw new Error('expected throw')
      } catch (err) {
        expect(err).toBeInstanceOf(CampaignGuardrailError)
        expect((err as CampaignGuardrailError).message.length).toBeLessThanOrEqual(500)
      }
    }
  })
})

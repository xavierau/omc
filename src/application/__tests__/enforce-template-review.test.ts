import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Campaign } from '@/domain/entities/campaign'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'

vi.mock('../check-template-review', () => ({
  checkTemplateReview: vi.fn(),
}))

import { enforceTemplateReview } from '../enforce-template-review'
import { checkTemplateReview } from '../check-template-review'
import type { TemplateReviewCheckResult } from '../check-template-review'
import {
  CampaignGuardrailError,
  FAILURE_REASON_MAX_LEN,
} from '../campaign-guardrail-error'

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
  // Keyed as a Record over the TrustReason union (mirroring CAUSE_BY_REASON)
  // so adding a 4th reason fails to compile here until its wording is specced.
  type ReasonKey = NonNullable<TemplateReviewCheckResult['trustReason']>
  interface ReasonCase {
    tokenSubstring: string
    causeSubstring: string
  }
  const REASON_CASES: Record<ReasonKey, ReasonCase> = {
    too_new: {
      tokenSubstring: 'trustReason=too_new',
      causeSubstring: 'less than 90 days old',
    },
    recent_quality_incident: {
      tokenSubstring: 'trustReason=recent_quality_incident',
      causeSubstring: 'quality-rating incident',
    },
    auto_paused: {
      tokenSubstring: 'trustReason=auto_paused',
      causeSubstring: 'auto-paused',
    },
  }
  const TRUST_REASON_CASES = [
    ...(Object.entries(REASON_CASES) as [ReasonKey, ReasonCase][]).map(
      ([trustReason, c]) => ({
        trustReason: trustReason as ReasonKey | undefined,
        ...c,
      })
    ),
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

  it("stays inside the queue's failure_reason cap for every trustReason", async () => {
    // The campaign-queue worker truncates campaigns.failure_reason past
    // FAILURE_REASON_MAX_LEN, so err.message must never exceed it or the
    // Meta-disambiguation clause (deliberately placed first) risks being
    // chopped by a future edit.
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
        expect(
          (err as CampaignGuardrailError).message.length
        ).toBeLessThanOrEqual(FAILURE_REASON_MAX_LEN)
      }
    }
  })

  it('clamps template names at the 56-char boundary', async () => {
    mockCheck.mockResolvedValue({
      allowed: false,
      reason: 'template_review_required',
      trustReason: 'too_new',
    })
    const atLimit = 'x'.repeat(56)
    const overLimit = 'y'.repeat(57)

    try {
      await enforceTemplateReview({
        campaign: CAMPAIGN,
        restaurantId: 'rest-1',
        template: makeTemplate({ name: atLimit }),
      })
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(CampaignGuardrailError)
      expect((err as CampaignGuardrailError).violations[0]).toContain(atLimit)
    }

    try {
      await enforceTemplateReview({
        campaign: CAMPAIGN,
        restaurantId: 'rest-1',
        template: makeTemplate({ name: overLimit }),
      })
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(CampaignGuardrailError)
      const violation = (err as CampaignGuardrailError).violations[0]
      expect(violation).toContain(`${'y'.repeat(56)}…`)
      expect(violation).not.toContain(overLimit)
    }
  })
})

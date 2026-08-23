import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildCampaign } from '@/test-utils/builders'

// Review round 3 (#102 item 2): safeCampaignTemplateReviewStates is shared
// by the list route AND the single-campaign GET route so both degrade OFF
// (REPLY-001 precedent) identically when the enrichment subsystem errors —
// campaigns still load, just without `templateReview`, never a 500.

vi.mock('@/application/build-campaign-template-review-states', () => ({
  buildCampaignTemplateReviewStates: vi.fn(),
}))

import { safeCampaignTemplateReviewStates, withTemplateReview } from '../with-template-review'
import { buildCampaignTemplateReviewStates } from '@/application/build-campaign-template-review-states'

describe('safeCampaignTemplateReviewStates', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the computed states on success', async () => {
    const states = new Map([['c-1', { required: true, status: 'pending' as const }]])
    vi.mocked(buildCampaignTemplateReviewStates).mockResolvedValue(states)

    const result = await safeCampaignTemplateReviewStates('r-1', [buildCampaign({ id: 'c-1' })])

    expect(result).toBe(states)
  })

  it('degrades OFF to an empty map (not a throw) when enrichment errors', async () => {
    vi.mocked(buildCampaignTemplateReviewStates).mockRejectedValue(
      new Error('template_review_queue unreachable')
    )
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await safeCampaignTemplateReviewStates('r-1', [buildCampaign({ id: 'c-1' })])

    expect(result).toEqual(new Map())
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })
})

describe('withTemplateReview', () => {
  it('attaches templateReview when present in the state map', () => {
    const campaign = buildCampaign({ id: 'c-1' })
    const states = new Map([['c-1', { required: true, status: 'pending' as const }]])

    const result = withTemplateReview(campaign, states)

    expect(result.templateReview).toEqual({ required: true, status: 'pending' })
  })

  it('omits templateReview when absent from the state map', () => {
    const campaign = buildCampaign({ id: 'c-1' })

    const result = withTemplateReview(campaign, new Map())

    expect('templateReview' in result).toBe(false)
  })
})

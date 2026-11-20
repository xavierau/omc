import { describe, it, expect, vi, beforeEach } from 'vitest'

// Review round 2 (#102 item 2): extracted from execute-campaign.ts's
// private enforceGuardrails so the synchronous send-time gate in
// POST /api/dashboard/campaigns/[id]/execute can run the EXACT same check
// (with the cron's documented targetMemberCount=0) before enqueueing,
// instead of only the worker catching a transient violation after 3
// attempts (~6s) permanently fail the campaign.

vi.mock('@/application/check-campaign-guardrails', () => ({
  checkCampaignGuardrails: vi.fn(),
}))

import { enforceCampaignGuardrails } from '../enforce-campaign-guardrails'
import { checkCampaignGuardrails } from '../check-campaign-guardrails'
import { CampaignGuardrailError } from '../campaign-guardrail-error'

describe('enforceCampaignGuardrails', () => {
  beforeEach(() => vi.clearAllMocks())

  it('resolves silently when allowed', async () => {
    vi.mocked(checkCampaignGuardrails).mockResolvedValue({
      allowed: true,
      violations: [],
      warnings: [],
      usage: {
        monthlySends: 0, monthlyLimit: 100, dailyCampaigns: 0, dailyLimit: 10,
        unsubscribeRate: 0, maxUnsubscribeRate: 0.05, autoThrottleFactor: 1,
        autoPauseActive: false,
      },
    })

    await expect(
      enforceCampaignGuardrails('r-1', 50)
    ).resolves.toBeUndefined()
  })

  it('throws CampaignGuardrailError with the violations when blocked', async () => {
    vi.mocked(checkCampaignGuardrails).mockResolvedValue({
      allowed: false,
      violations: ['Daily campaign limit reached (1/1)'],
      warnings: [],
      usage: {
        monthlySends: 0, monthlyLimit: 100, dailyCampaigns: 1, dailyLimit: 1,
        unsubscribeRate: 0, maxUnsubscribeRate: 0.05, autoThrottleFactor: 1,
        autoPauseActive: false,
      },
    })

    const err = await enforceCampaignGuardrails('r-1', 50).catch((e) => e)
    expect(err).toBeInstanceOf(CampaignGuardrailError)
    expect(err.violations).toEqual(['Daily campaign limit reached (1/1)'])
  })

  it('passes restaurantId and targetMemberCount through unchanged', async () => {
    vi.mocked(checkCampaignGuardrails).mockResolvedValue({
      allowed: true, violations: [], warnings: [],
      usage: {
        monthlySends: 0, monthlyLimit: 100, dailyCampaigns: 0, dailyLimit: 10,
        unsubscribeRate: 0, maxUnsubscribeRate: 0.05, autoThrottleFactor: 1,
        autoPauseActive: false,
      },
    })

    await enforceCampaignGuardrails('r-1', 0)

    expect(checkCampaignGuardrails).toHaveBeenCalledWith('r-1', 0)
  })

  it('logs warnings without throwing when allowed but approaching a limit', async () => {
    vi.mocked(checkCampaignGuardrails).mockResolvedValue({
      allowed: true,
      violations: [],
      warnings: ['You are approaching your monthly send limit (90/100)'],
      usage: {
        monthlySends: 90, monthlyLimit: 100, dailyCampaigns: 0, dailyLimit: 10,
        unsubscribeRate: 0, maxUnsubscribeRate: 0.05, autoThrottleFactor: 1,
        autoPauseActive: false,
      },
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await enforceCampaignGuardrails('r-1', 5)

    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})

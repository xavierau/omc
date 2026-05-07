import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/application/check-campaign-guardrails', () => ({
  checkCampaignGuardrails: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/quality-state-repository', () => ({
  isGreenForDays: vi.fn(),
  findLatest: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/consent-record-repository', () => ({
  countByGradeStatus: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/campaign-settings-repository', () => ({
  getReconfirmationDailyCap: vi.fn(),
  getReconfirmationSendsToday: vi.fn(),
}))

import { checkReconfirmationEligibility } from '../check-reconfirmation-eligibility'
import { checkCampaignGuardrails } from '@/application/check-campaign-guardrails'
import {
  isGreenForDays,
  findLatest,
} from '@/infrastructure/supabase/repositories/quality-state-repository'
import { QualityStateEvent } from '@/domain/entities/quality-state-event'
import { countByGradeStatus } from '@/infrastructure/supabase/repositories/consent-record-repository'
import {
  getReconfirmationDailyCap,
  getReconfirmationSendsToday,
} from '@/infrastructure/supabase/repositories/campaign-settings-repository'

function happyGuardrails() {
  return {
    allowed: true,
    violations: [],
    warnings: [],
    usage: {
      monthlySends: 0,
      monthlyLimit: 1000,
      dailyCampaigns: 0,
      dailyLimit: 5,
      unsubscribeRate: 0,
      maxUnsubscribeRate: 0.05,
      autoThrottleFactor: 1,
      autoPauseActive: false,
    },
  }
}

describe('checkReconfirmationEligibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(checkCampaignGuardrails).mockResolvedValue(happyGuardrails())
    vi.mocked(isGreenForDays).mockResolvedValue(true)
    vi.mocked(countByGradeStatus).mockResolvedValue(42)
    vi.mocked(getReconfirmationDailyCap).mockResolvedValue(50)
    vi.mocked(getReconfirmationSendsToday).mockResolvedValue(0)
    vi.mocked(findLatest).mockResolvedValue(null)
  })

  it('returns allowed=true with audience size + cap context on the happy path', async () => {
    const r = await checkReconfirmationEligibility({ restaurantId: 'r-1' })
    expect(r).toEqual({
      allowed: true,
      violations: [],
      audienceCount: 42,
      currentDailySent: 0,
      cap: 50,
    })
    expect(checkCampaignGuardrails).toHaveBeenCalledWith('r-1', 0)
    expect(countByGradeStatus).toHaveBeenCalledWith({
      restaurantId: 'r-1',
      grade: 'weak',
      status: 'opted_in',
      category: 'marketing',
    })
  })

  it('rejects with quality_not_green when isGreenForDays returns false', async () => {
    vi.mocked(isGreenForDays).mockResolvedValue(false)
    const r = await checkReconfirmationEligibility({ restaurantId: 'r-1' })
    expect(r.allowed).toBe(false)
    expect(r.violations.map((v) => v.key)).toContain('quality_not_green')
  })

  it('quality_not_green.detail uses "<STATE> since <YYYY-MM-DD>" format from latest event', async () => {
    vi.mocked(isGreenForDays).mockResolvedValue(false)
    vi.mocked(findLatest).mockResolvedValue(
      QualityStateEvent.fromProps({
        id: 'q-1',
        restaurantId: 'r-1',
        phoneNumberId: 'pn-1',
        displayPhoneNumber: null,
        qualityRating: 'YELLOW',
        messagingTier: null,
        flagged: false,
        rawPayload: null,
        transitionedAt: '2026-04-30T08:00:00.000Z',
      })
    )
    const r = await checkReconfirmationEligibility({ restaurantId: 'r-1' })
    const v = r.violations.find((x) => x.key === 'quality_not_green')
    expect(v?.detail).toBe('YELLOW since 2026-04-30')
  })

  it('quality_not_green.detail falls back to UNKNOWN since unknown when no event row', async () => {
    vi.mocked(isGreenForDays).mockResolvedValue(false)
    vi.mocked(findLatest).mockResolvedValue(null)
    const r = await checkReconfirmationEligibility({ restaurantId: 'r-1' })
    const v = r.violations.find((x) => x.key === 'quality_not_green')
    expect(v?.detail).toBe('UNKNOWN since unknown')
  })

  it('rejects with empty_audience when count is zero', async () => {
    vi.mocked(countByGradeStatus).mockResolvedValue(0)
    const r = await checkReconfirmationEligibility({ restaurantId: 'r-1' })
    expect(r.allowed).toBe(false)
    expect(r.violations.map((v) => v.key)).toContain('empty_audience')
    expect(r.audienceCount).toBe(0)
  })

  it('rejects with daily_cap_met when current sends meet the cap', async () => {
    vi.mocked(getReconfirmationDailyCap).mockResolvedValue(50)
    vi.mocked(getReconfirmationSendsToday).mockResolvedValue(50)
    const r = await checkReconfirmationEligibility({ restaurantId: 'r-1' })
    expect(r.allowed).toBe(false)
    expect(r.violations.map((v) => v.key)).toContain('daily_cap_met')
    expect(r.currentDailySent).toBe(50)
    expect(r.cap).toBe(50)
  })

  it('rejects with daily_cap_met when current sends exceed the cap', async () => {
    vi.mocked(getReconfirmationDailyCap).mockResolvedValue(50)
    vi.mocked(getReconfirmationSendsToday).mockResolvedValue(60)
    const r = await checkReconfirmationEligibility({ restaurantId: 'r-1' })
    expect(r.allowed).toBe(false)
    expect(r.violations.map((v) => v.key)).toContain('daily_cap_met')
  })

  it('rejects with auto_paused when checkCampaignGuardrails reports auto-pause', async () => {
    vi.mocked(checkCampaignGuardrails).mockResolvedValue({
      ...happyGuardrails(),
      allowed: false,
      violations: ['Campaigns auto-paused by quality monitor: YELLOW'],
      usage: {
        ...happyGuardrails().usage,
        autoPauseActive: true,
      },
    })
    const r = await checkReconfirmationEligibility({ restaurantId: 'r-1' })
    expect(r.allowed).toBe(false)
    expect(r.violations.map((v) => v.key)).toContain('auto_paused')
  })

  it('reports multiple violations together when multiple gates fail', async () => {
    vi.mocked(isGreenForDays).mockResolvedValue(false)
    vi.mocked(countByGradeStatus).mockResolvedValue(0)
    const r = await checkReconfirmationEligibility({ restaurantId: 'r-1' })
    expect(r.allowed).toBe(false)
    const keys = r.violations.map((v) => v.key)
    expect(keys).toContain('quality_not_green')
    expect(keys).toContain('empty_audience')
  })
})

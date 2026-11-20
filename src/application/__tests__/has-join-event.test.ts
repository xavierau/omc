import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/client')
vi.mock('@/infrastructure/supabase/repositories/restaurant-onboarding-repository')

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { getOnboardingSettings } from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import { canClaimWelcome } from '../has-join-event'

type Result = { data: unknown[] | null; error: { message: string } | null }

// One chain per table so the events and coupons queries are asserted apart.
// coupons runs two queries (r2 G3): the campaigns!inner embed picks viaCampaign.
function tableChain() {
  const calls: Array<[string, ...unknown[]]> = []
  const limit = vi.fn<(n: number) => Promise<Result>>()
  const viaCampaign = vi.fn<(n: number) => Promise<Result>>()
  const selects: string[] = []
  const select = vi.fn((cols?: string) => {
    selects.push(String(cols))
    const embed = String(cols).includes('campaigns!inner')
    const chain = {
      eq: vi.fn((col: string, val: unknown) => (calls.push(['eq', col, val]), chain)),
      order: vi.fn(() => chain),
      limit: embed ? viaCampaign : limit,
    }
    return chain
  })
  return { calls, limit, viaCampaign, selects, select }
}

let events = tableChain()
let coupons = tableChain()
const mockFrom = vi.fn((table: string) => ({ select: (table === 'events' ? events : coupons).select }))

function settings(welcomeCampaignId: string | null) {
  return {
    welcomeCampaignId,
    returningMemberTemplate: null,
    returningMemberTemplateEn: null,
    returningMemberTemplateZhHk: null,
    defaultLanguage: 'en' as const,
  }
}

describe('canClaimWelcome (WONB-020)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    events = tableChain()
    coupons = tableChain()
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: mockFrom } as never)
    vi.mocked(getOnboardingSettings).mockResolvedValue(settings(null))
    events.limit.mockResolvedValue({ data: [], error: null })
    coupons.limit.mockResolvedValue({ data: [], error: null })
    coupons.viaCampaign.mockResolvedValue({ data: [], error: null })
  })

  it('queries one join event scoped to restaurant + member', async () => {
    await canClaimWelcome('rest-1', 'm-1')

    expect(events.calls).toEqual([
      ['eq', 'restaurant_id', 'rest-1'],
      ['eq', 'member_id', 'm-1'],
      ['eq', 'type', 'join'],
    ])
    expect(events.limit).toHaveBeenCalledWith(1)
  })

  it('no join event and no welcome coupon -> claimable', async () => {
    expect(await canClaimWelcome('rest-1', 'm-1')).toBe(true)
  })

  it('a join event exists -> not claimable', async () => {
    events.limit.mockResolvedValue({ data: [{ id: 'e-1' }], error: null })
    expect(await canClaimWelcome('rest-1', 'm-1')).toBe(false)
  })

  it('AC-5: a DB error -> not claimable, with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    events.limit.mockResolvedValue({ data: null, error: { message: 'connection reset' } })

    expect(await canClaimWelcome('rest-1', 'm-1')).toBe(false)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('lookup failed'),
      expect.objectContaining({ message: expect.stringContaining('connection reset') })
    )
    warn.mockRestore()
  })

  // r1 F2: a mint whose join-event write failed leaves a coupon and no event;
  // the coupon alone must stop a second mint. r2 G3: a coupon of ANY
  // welcome-type campaign counts, not just the one mapped now.
  describe('r1 F2 / r2 G3: an existing welcome coupon blocks the claim', () => {
    it('AC-3: holds a type welcome coupon, no join event -> not claimable', async () => {
      coupons.limit.mockResolvedValue({ data: [{ code: 'W1', created_at: '2026-11-20T00:00:00Z' }], error: null })

      expect(await canClaimWelcome('rest-1', 'm-1')).toBe(false)
      expect(coupons.calls).toContainEqual(['eq', 'type', 'welcome'])
    })

    it('AC-3: holds a promo coupon of a NON-current welcome-type campaign, no join event -> not claimable', async () => {
      // the restaurant now maps a different welcome campaign
      vi.mocked(getOnboardingSettings).mockResolvedValue(settings('camp-new'))
      coupons.viaCampaign.mockResolvedValue({ data: [{ code: 'OLD1', created_at: '2026-01-01T00:00:00Z' }], error: null })

      expect(await canClaimWelcome('rest-1', 'm-1')).toBe(false)
      expect(coupons.calls).toContainEqual(['eq', 'campaigns.type', 'welcome'])
      expect(coupons.calls).toContainEqual(['eq', 'campaigns.restaurant_id', 'rest-1'])
    })

    it('AC-3: no welcome coupon of either kind -> claimable, both lookups ran, no settings load', async () => {
      expect(await canClaimWelcome('rest-1', 'm-1')).toBe(true)
      expect(mockFrom).toHaveBeenCalledWith('events')
      expect(coupons.limit).toHaveBeenCalledTimes(1)
      expect(coupons.viaCampaign).toHaveBeenCalledTimes(1)
      expect(getOnboardingSettings).not.toHaveBeenCalled()
    })

    it('AC-3: a coupon lookup error -> not claimable, with a warning', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      coupons.viaCampaign.mockResolvedValue({ data: null, error: { message: 'coupons timeout' } })

      expect(await canClaimWelcome('rest-1', 'm-1')).toBe(false)
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('lookup failed'),
        expect.objectContaining({ message: expect.stringContaining('coupons timeout') })
      )
      warn.mockRestore()
    })
  })
})

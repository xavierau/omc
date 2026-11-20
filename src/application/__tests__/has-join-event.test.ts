import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/client')
vi.mock('@/infrastructure/supabase/repositories/restaurant-onboarding-repository')

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { getOnboardingSettings } from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import { canClaimWelcome } from '../has-join-event'

type Result = { data: unknown[] | null; error: { message: string } | null }

// One chain per table so the events and coupons queries are asserted apart.
function tableChain() {
  const calls: Array<[string, ...unknown[]]> = []
  const limit = vi.fn<(n: number) => Promise<Result>>()
  const chain = {
    eq: vi.fn((col: string, val: unknown) => (calls.push(['eq', col, val]), chain)),
    or: vi.fn((filter: string) => (calls.push(['or', filter]), chain)),
    limit,
  }
  return { calls, limit, select: vi.fn().mockReturnValue(chain) }
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
  // the coupon alone must stop a second mint.
  describe('r1 F2: an existing welcome coupon blocks the claim', () => {
    it('AC-3: holds a type welcome coupon, no join event -> not claimable', async () => {
      coupons.limit.mockResolvedValue({ data: [{ id: 'c-1' }], error: null })

      expect(await canClaimWelcome('rest-1', 'm-1')).toBe(false)
      expect(coupons.calls).toEqual([
        ['eq', 'restaurant_id', 'rest-1'],
        ['eq', 'member_id', 'm-1'],
        ['or', 'type.eq.welcome'],
      ])
      expect(coupons.limit).toHaveBeenCalledWith(1)
    })

    it('AC-3: with a welcome campaign mapped, a coupon of that campaign also counts', async () => {
      vi.mocked(getOnboardingSettings).mockResolvedValue(settings('camp-9'))
      coupons.limit.mockResolvedValue({ data: [{ id: 'c-2' }], error: null })

      expect(await canClaimWelcome('rest-1', 'm-1')).toBe(false)
      expect(coupons.calls).toContainEqual(['or', 'type.eq.welcome,campaign_id.eq.camp-9'])
    })

    it('AC-3: no welcome coupon of either kind -> claimable, both lookups ran', async () => {
      vi.mocked(getOnboardingSettings).mockResolvedValue(settings('camp-9'))

      expect(await canClaimWelcome('rest-1', 'm-1')).toBe(true)
      expect(mockFrom).toHaveBeenCalledWith('events')
      expect(mockFrom).toHaveBeenCalledWith('coupons')
    })

    it('AC-3: a coupon lookup error -> not claimable, with a warning', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      coupons.limit.mockResolvedValue({ data: null, error: { message: 'coupons timeout' } })

      expect(await canClaimWelcome('rest-1', 'm-1')).toBe(false)
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('lookup failed'),
        expect.objectContaining({ message: expect.stringContaining('coupons timeout') })
      )
      warn.mockRestore()
    })

    it('AC-3: an onboarding settings error -> not claimable', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.mocked(getOnboardingSettings).mockRejectedValue(new Error('getOnboardingSettings: restaurant not found'))

      expect(await canClaimWelcome('rest-1', 'm-1')).toBe(false)
      warn.mockRestore()
    })
  })
})

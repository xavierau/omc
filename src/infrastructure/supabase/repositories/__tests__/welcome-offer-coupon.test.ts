import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import { findLatestWelcomeOfferCode, hasWelcomeCoupon } from '../coupon-repository'

type Row = { code: string; created_at: string }
type Result = { data: Row[] | null; error: { message: string } | null }

// One recorded chain per coupons query; the embed in select() tells them apart.
function couponsClient(results: { plain: Result; viaCampaign: Result }) {
  const queries: Array<{ select: string; calls: unknown[][] }> = []
  const from = vi.fn(() => ({
    select: (cols: string) => {
      const q = { select: cols, calls: [] as unknown[][] }
      queries.push(q)
      const result = cols.includes('campaigns!inner') ? results.viaCampaign : results.plain
      const chain = {
        eq: (...a: unknown[]) => (q.calls.push(['eq', ...a]), chain),
        order: (...a: unknown[]) => (q.calls.push(['order', ...a]), chain),
        limit: (n: number) => (q.calls.push(['limit', n]), Promise.resolve(result)),
      }
      return chain
    },
  }))
  vi.mocked(createServerSupabaseClient).mockReturnValue({ from } as never)
  return { from, queries }
}

const none: Result = { data: [], error: null }

describe('findLatestWelcomeOfferCode / hasWelcomeCoupon (WONB-020 r2 G3)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('queries welcome-type coupons and coupons of ANY welcome-type campaign, both tenant-scoped', async () => {
    const { from, queries } = couponsClient({ plain: none, viaCampaign: none })

    await findLatestWelcomeOfferCode('rest-1', 'm-1')

    expect(from).toHaveBeenCalledWith('coupons')
    const plain = queries.find((q) => !q.select.includes('campaigns!inner'))!
    const viaCampaign = queries.find((q) => q.select.includes('campaigns!inner(type)'))!
    expect(plain.calls).toEqual([
      ['eq', 'restaurant_id', 'rest-1'],
      ['eq', 'member_id', 'm-1'],
      ['eq', 'type', 'welcome'],
      ['order', 'created_at', { ascending: false }],
      ['limit', 1],
    ])
    expect(viaCampaign.calls).toEqual([
      ['eq', 'restaurant_id', 'rest-1'],
      ['eq', 'member_id', 'm-1'],
      ['eq', 'campaigns.type', 'welcome'],
      ['eq', 'campaigns.restaurant_id', 'rest-1'],
      ['order', 'created_at', { ascending: false }],
      ['limit', 1],
    ])
    // No campaign id in any filter: a non-current welcome campaign counts too.
    expect(JSON.stringify(queries)).not.toMatch(/campaign_id/)
  })

  it('AC-3: a promo coupon of a non-current welcome-type campaign -> found', async () => {
    couponsClient({
      plain: none,
      viaCampaign: { data: [{ code: 'OLDCAMP1', created_at: '2026-01-01T00:00:00+00:00' }], error: null },
    })

    expect(await findLatestWelcomeOfferCode('rest-1', 'm-1')).toBe('OLDCAMP1')
    expect(await hasWelcomeCoupon('rest-1', 'm-1')).toBe(true)
  })

  it('both kinds held -> the most recent code', async () => {
    couponsClient({
      plain: { data: [{ code: 'PLAIN1', created_at: '2026-11-20T05:00:00+00:00' }], error: null },
      viaCampaign: { data: [{ code: 'CAMP1', created_at: '2026-11-20T06:00:00+00:00' }], error: null },
    })

    expect(await findLatestWelcomeOfferCode('rest-1', 'm-1')).toBe('CAMP1')
  })

  it('neither kind -> null / false', async () => {
    couponsClient({ plain: none, viaCampaign: { data: null, error: null } })

    expect(await findLatestWelcomeOfferCode('rest-1', 'm-1')).toBeNull()
    expect(await hasWelcomeCoupon('rest-1', 'm-1')).toBe(false)
  })

  it('either query erroring throws, never reads as "no coupon"', async () => {
    couponsClient({ plain: none, viaCampaign: { data: null, error: { message: 'embed failed' } } })
    await expect(hasWelcomeCoupon('rest-1', 'm-1')).rejects.toThrow('embed failed')

    couponsClient({ plain: { data: null, error: { message: 'coupons timeout' } }, viaCampaign: none })
    await expect(findLatestWelcomeOfferCode('rest-1', 'm-1')).rejects.toThrow('coupons timeout')
  })
})

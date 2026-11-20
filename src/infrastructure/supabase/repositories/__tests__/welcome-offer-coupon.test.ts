import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import { createCoupon, findLatestWelcomeOfferCode, hasWelcomeCoupon } from '../coupon-repository'

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
        or: (...a: unknown[]) => (q.calls.push(['or', ...a]), chain),
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
      ['or', 'type.eq.welcome,welcome_offer.is.true'],
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

// r4 H2: rows evaluated against the real filter strings, so these cases test
// the query itself, not a canned answer.
type CouponRow = {
  code: string
  created_at: string
  restaurant_id: string
  member_id: string
  type: 'welcome' | 'promo' | 'reward' | 'shared'
  welcome_offer: boolean
  campaign: { type: string; restaurant_id: string } | null
}

function field(row: CouponRow, col: string): unknown {
  if (col.startsWith('campaigns.')) return row.campaign?.[col.slice('campaigns.'.length) as 'type']
  return row[col as keyof CouponRow]
}

function matchesOr(row: CouponRow, filter: string): boolean {
  return filter.split(',').some((part) => {
    const [col, op, val] = part.split('.')
    if (op === 'eq') return String(field(row, col)) === val
    if (op === 'is') return field(row, col) === (val === 'true' ? true : val === 'false' ? false : null)
    throw new Error(`unsupported or-op ${op}`)
  })
}

function rowsClient(rows: CouponRow[]) {
  const from = vi.fn(() => ({
    select: (cols: string) => {
      let hits = cols.includes('campaigns!inner') ? rows.filter((r) => r.campaign) : [...rows]
      const chain = {
        eq: (col: string, val: unknown) => ((hits = hits.filter((r) => field(r, col) === val)), chain),
        or: (filter: string) => ((hits = hits.filter((r) => matchesOr(r, filter))), chain),
        order: () => ((hits = hits.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))), chain),
        limit: (n: number) => Promise.resolve({ data: hits.slice(0, n), error: null }),
      }
      return chain
    },
  }))
  vi.mocked(createServerSupabaseClient).mockReturnValue({ from } as never)
}

function coupon(overrides: Partial<CouponRow>): CouponRow {
  return {
    code: 'C1',
    created_at: '2026-11-20T05:00:00+00:00',
    restaurant_id: 'rest-1',
    member_id: 'm-1',
    type: 'promo',
    welcome_offer: false,
    campaign: null,
    ...overrides,
  }
}

describe('welcome provenance on the coupon (WONB-020 r4 H2)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('AC-3: a promo coupon with welcome_offer=true whose campaign was deleted (campaign_id NULL) -> found, not claimable', async () => {
    rowsClient([coupon({ code: 'ORPHAN1', welcome_offer: true, campaign: null })])

    expect(await findLatestWelcomeOfferCode('rest-1', 'm-1')).toBe('ORPHAN1')
    expect(await hasWelcomeCoupon('rest-1', 'm-1')).toBe(true)
  })

  it('AC-3: a welcome_offer coupon whose campaign was retyped to promo -> still found', async () => {
    rowsClient([coupon({ code: 'RETYPED1', welcome_offer: true, campaign: { type: 'promo', restaurant_id: 'rest-1' } })])

    expect(await findLatestWelcomeOfferCode('rest-1', 'm-1')).toBe('RETYPED1')
  })

  it('AC-3: an ordinary promo coupon (welcome_offer=false, promo campaign) -> not a welcome offer', async () => {
    rowsClient([coupon({ code: 'PROMO1', campaign: { type: 'promo', restaurant_id: 'rest-1' } })])

    expect(await findLatestWelcomeOfferCode('rest-1', 'm-1')).toBeNull()
    expect(await hasWelcomeCoupon('rest-1', 'm-1')).toBe(false)
  })

  it('tenant-scoped: another restaurant\'s welcome_offer coupon for the same member id -> not found', async () => {
    rowsClient([coupon({ code: 'OTHER1', restaurant_id: 'rest-2', welcome_offer: true })])

    expect(await findLatestWelcomeOfferCode('rest-1', 'm-1')).toBeNull()
  })

  it('an unmarked coupon of a welcome-type campaign is still found (mints that do not set the mark)', async () => {
    rowsClient([coupon({ code: 'PARTNER1', campaign: { type: 'welcome', restaurant_id: 'rest-1' } })])

    expect(await findLatestWelcomeOfferCode('rest-1', 'm-1')).toBe('PARTNER1')
  })
})

describe('createCoupon welcome_offer column (WONB-020 r4 H2)', () => {
  beforeEach(() => vi.clearAllMocks())

  function insertClient() {
    const insert = vi.fn(() => ({
      select: () => ({
        single: () => Promise.resolve({ data: { id: 'c-1', code: 'X', created_at: '2026-11-20T00:00:00Z' }, error: null }),
      }),
    }))
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: vi.fn(() => ({ insert })) } as never)
    return insert
  }

  it('AC-3: welcomeOffer true -> writes welcome_offer: true', async () => {
    const insert = insertClient()

    await createCoupon({ restaurantId: 'rest-1', type: 'promo', code: 'X', welcomeOffer: true })

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ welcome_offer: true }))
  })

  it('AC-3: no welcomeOffer (ordinary promo) -> the column is left to its DB default false', async () => {
    const insert = insertClient()

    await createCoupon({ restaurantId: 'rest-1', type: 'promo', code: 'X', campaignId: 'camp-promo' })

    const [row] = insert.mock.calls[0] as unknown as [Record<string, unknown>]
    expect(row).not.toHaveProperty('welcome_offer')
  })
})

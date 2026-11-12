import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import { countExpiredCampaignCoupons } from '../coupon-campaign-queries'

function chainClient(result: Record<string, unknown>) {
  const from = vi.fn()
  const select = vi.fn()
  const eq = vi.fn()
  const lt = vi.fn()
  const chain = {
    select,
    eq,
    lt,
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
  }
  for (const fn of [from, select, eq, lt]) fn.mockReturnValue(chain)
  vi.mocked(createServerSupabaseClient).mockReturnValue({ from } as never)
  return { from, select, eq, lt }
}

describe('countExpiredCampaignCoupons (CAMP-014)', () => {
  const NOW = '2026-11-05T02:00:00.000Z'
  const scope = { campaignId: 'c-1', restaurantId: 'r-1' }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ now: new Date(NOW) })
  })
  afterEach(() => vi.useRealTimers())

  it('head counts this tenant and campaign coupons whose expires_at has passed', async () => {
    const { from, select, eq, lt } = chainClient({ count: 3, error: null })

    await expect(countExpiredCampaignCoupons(scope)).resolves.toBe(3)

    expect(from).toHaveBeenCalledWith('coupons')
    expect(select).toHaveBeenCalledWith('id', { count: 'exact', head: true })
    expect(eq.mock.calls).toEqual([
      ['campaign_id', 'c-1'],
      ['restaurant_id', 'r-1'],
    ])
    expect(lt).toHaveBeenCalledWith('expires_at', NOW)
  })

  it('reads a null count as zero', async () => {
    chainClient({ count: null, error: null })
    await expect(countExpiredCampaignCoupons(scope)).resolves.toBe(0)
  })

  it('throws on a query error, never reading it as zero', async () => {
    chainClient({ count: null, error: { message: 'db down' } })
    await expect(countExpiredCampaignCoupons(scope)).rejects.toThrow(
      'countExpiredCampaignCoupons: db down'
    )
  })
})

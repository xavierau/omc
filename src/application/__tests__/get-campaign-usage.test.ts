import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock(
  '@/infrastructure/supabase/repositories/campaign-usage-repository',
  () => ({
    getCampaignsForTenantMonth: vi.fn(),
  })
)

import { getCampaignUsage } from '../get-campaign-usage'
import { getCampaignsForTenantMonth } from '@/infrastructure/supabase/repositories/campaign-usage-repository'
import type { Campaign } from '@/domain/entities/campaign'

const mockGetCampaigns = vi.mocked(getCampaignsForTenantMonth)

const RESTAURANT_ID = 'rest-123'

function makeCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 'camp-1',
    restaurantId: RESTAURANT_ID,
    name: 'Test Campaign',
    type: 'promo',
    template: 'tpl',
    templateEn: null,
    templateZhHk: null,
    imageUrlEn: null,
    imageUrlZhHk: null,
    couponConfig: null,
    schedule: null,
    scheduledAt: null,
    status: 'completed',
    mode: 'marketing',
    isChargeable: true,
    chargeableSentCount: 100,
    nonChargeableSentCount: 0,
    redeemedCount: 10,
    whatsappTemplateId: null,
    targetAudience: 'all',
    createdAt: '2026-04-05T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => vi.clearAllMocks())

describe('getCampaignUsage', () => {
  it('returns campaigns mapped with correct cost calculations', async () => {
    mockGetCampaigns.mockResolvedValue([
      makeCampaign({ id: 'c1', name: 'Promo A', chargeableSentCount: 100 }),
    ])

    const result = await getCampaignUsage(RESTAURANT_ID, '2026-04')

    expect(result.campaigns).toHaveLength(1)
    expect(result.campaigns[0]).toEqual({
      campaignId: 'c1',
      campaignName: 'Promo A',
      category: 'marketing',
      sentCount: 100,
      estimatedCost: 7.32,
      executedAt: '2026-04-05T00:00:00.000Z',
    })
  })

  it('sums totalSent across chargeable+non-chargeable and computes total cost', async () => {
    mockGetCampaigns.mockResolvedValue([
      makeCampaign({ id: 'c1', chargeableSentCount: 100 }),
      makeCampaign({
        id: 'c2',
        chargeableSentCount: 150,
        nonChargeableSentCount: 50,
      }),
    ])

    const result = await getCampaignUsage(RESTAURANT_ID, '2026-04')

    expect(result.totalSent).toBe(300)
    expect(result.totalEstimatedCost).toBe(
      Math.round((7.32 + 14.64) * 10000) / 10000
    )
  })

  it('defaults to current month when no month param', async () => {
    mockGetCampaigns.mockResolvedValue([])

    const result = await getCampaignUsage(RESTAURANT_ID)
    const now = new Date()
    const expectedMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

    expect(result.month).toBe(expectedMonth)
    expect(mockGetCampaigns).toHaveBeenCalledWith(
      RESTAURANT_ID,
      expect.any(String),
      expect.any(String)
    )
  })

  it('returns empty summary when no campaigns exist', async () => {
    mockGetCampaigns.mockResolvedValue([])

    const result = await getCampaignUsage(RESTAURANT_ID, '2026-04')

    expect(result.totalSent).toBe(0)
    expect(result.totalEstimatedCost).toBe(0)
    expect(result.campaigns).toEqual([])
    expect(result.month).toBe('2026-04')
  })

  it('handles month parameter correctly', async () => {
    mockGetCampaigns.mockResolvedValue([])

    await getCampaignUsage(RESTAURANT_ID, '2026-04')

    expect(mockGetCampaigns).toHaveBeenCalledWith(
      RESTAURANT_ID,
      '2026-04-01T00:00:00.000Z',
      '2026-05-01T00:00:00.000Z'
    )
  })
})

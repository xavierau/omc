import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock(
  '@/infrastructure/supabase/repositories/campaign-settings-repository',
  () => ({
    upsertSettings: vi.fn(),
  })
)

import { pauseTenantCampaigns } from '../pause-tenant-campaigns'
import { upsertSettings } from '@/infrastructure/supabase/repositories/campaign-settings-repository'

const mockUpsert = vi.mocked(upsertSettings)

beforeEach(() => vi.clearAllMocks())

describe('pauseTenantCampaigns', () => {
  it('calls upsertSettings with campaignPaused true and reason', async () => {
    mockUpsert.mockResolvedValue({
      restaurantId: 'rest-1',
      monthlySendLimit: 1000,
      dailyCampaignLimit: 1,
      maxUnsubscribeRate: 0.05,
      campaignPaused: true,
      pausedReason: 'Abuse detected',
      perUserMarketingCap: 1,
      autoThrottleFactor: 1,
      autoPauseActive: false,
      autoPauseReason: null,
      autoPauseSetAt: null,
    })

    await pauseTenantCampaigns('rest-1', 'Abuse detected')

    expect(mockUpsert).toHaveBeenCalledWith('rest-1', {
      campaignPaused: true,
      pausedReason: 'Abuse detected',
      pausedAt: expect.any(Date),
    })
  })

  it('sets pausedAt timestamp', async () => {
    mockUpsert.mockResolvedValue({
      restaurantId: 'rest-1',
      monthlySendLimit: 1000,
      dailyCampaignLimit: 1,
      maxUnsubscribeRate: 0.05,
      campaignPaused: true,
      perUserMarketingCap: 1,
      autoThrottleFactor: 1,
      autoPauseActive: false,
      autoPauseReason: null,
      autoPauseSetAt: null,
    })

    const before = new Date()
    await pauseTenantCampaigns('rest-1', 'test')
    const after = new Date()

    const call = mockUpsert.mock.calls[0][1] as { pausedAt: Date }
    expect(call.pausedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(call.pausedAt.getTime()).toBeLessThanOrEqual(after.getTime())
  })
})

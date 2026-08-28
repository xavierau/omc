import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock(
  '@/infrastructure/supabase/repositories/campaign-settings-repository',
  () => ({
    upsertSettings: vi.fn(),
  })
)

import { updateTenantCampaignSettings } from '../update-tenant-campaign-settings'
import { upsertSettings } from '@/infrastructure/supabase/repositories/campaign-settings-repository'

const mockUpsert = vi.mocked(upsertSettings)

beforeEach(() => vi.clearAllMocks())

describe('updateTenantCampaignSettings', () => {
  it('passes input fields to upsertSettings', async () => {
    const expected = {
      restaurantId: 'rest-1',
      monthlySendLimit: 2000,
      dailyCampaignLimit: 5,
      maxUnsubscribeRate: 0.1,
      campaignPaused: false,
      perUserMarketingCap: 1,
      autoThrottleFactor: 1,
      autoPauseActive: false,
      autoPauseReason: null,
      autoPauseSetAt: null,
      pacingStrategy: 'engagement_tier' as const,
      probeChunkSize: 100,
      scaleChunkSize: 100,
      activeHoursStartLocal: '10:00:00',
      activeHoursEndLocal: '22:00:00',
      tenantTimezone: 'Asia/Hong_Kong',
    }
    mockUpsert.mockResolvedValue(expected)

    const result = await updateTenantCampaignSettings('rest-1', {
      monthlySendLimit: 2000,
      dailyCampaignLimit: 5,
      maxUnsubscribeRate: 0.1,
    })

    expect(mockUpsert).toHaveBeenCalledWith('rest-1', {
      monthlySendLimit: 2000,
      dailyCampaignLimit: 5,
      maxUnsubscribeRate: 0.1,
    })
    expect(result).toEqual(expected)
  })

  it('handles partial updates', async () => {
    const expected = {
      restaurantId: 'rest-1',
      monthlySendLimit: 5000,
      dailyCampaignLimit: 1,
      maxUnsubscribeRate: 0.05,
      campaignPaused: false,
      perUserMarketingCap: 1,
      autoThrottleFactor: 1,
      autoPauseActive: false,
      autoPauseReason: null,
      autoPauseSetAt: null,
      pacingStrategy: 'engagement_tier' as const,
      probeChunkSize: 100,
      scaleChunkSize: 100,
      activeHoursStartLocal: '10:00:00',
      activeHoursEndLocal: '22:00:00',
      tenantTimezone: 'Asia/Hong_Kong',
    }
    mockUpsert.mockResolvedValue(expected)

    await updateTenantCampaignSettings('rest-1', {
      monthlySendLimit: 5000,
    })

    expect(mockUpsert).toHaveBeenCalledWith('rest-1', {
      monthlySendLimit: 5000,
    })
  })
})

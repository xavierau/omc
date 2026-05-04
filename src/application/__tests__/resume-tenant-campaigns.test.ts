import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock(
  '@/infrastructure/supabase/repositories/campaign-settings-repository',
  () => ({
    upsertSettings: vi.fn(),
  })
)

import { resumeTenantCampaigns } from '../resume-tenant-campaigns'
import { upsertSettings } from '@/infrastructure/supabase/repositories/campaign-settings-repository'

const mockUpsert = vi.mocked(upsertSettings)

beforeEach(() => vi.clearAllMocks())

describe('resumeTenantCampaigns', () => {
  it('calls upsertSettings with campaignPaused false', async () => {
    mockUpsert.mockResolvedValue({
      restaurantId: 'rest-1',
      monthlySendLimit: 1000,
      dailyCampaignLimit: 1,
      maxUnsubscribeRate: 0.05,
      campaignPaused: false,
      perUserMarketingCap: 1,
      autoThrottleFactor: 1,
      autoPauseActive: false,
      autoPauseReason: null,
      autoPauseSetAt: null,
    })

    await resumeTenantCampaigns('rest-1')

    expect(mockUpsert).toHaveBeenCalledWith('rest-1', {
      campaignPaused: false,
      pausedReason: null,
      pausedAt: null,
    })
  })
})

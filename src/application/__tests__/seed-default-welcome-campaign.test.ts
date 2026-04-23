import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/campaign-repository')
vi.mock('@/infrastructure/supabase/repositories/restaurant-onboarding-repository')

import {
  createCampaign,
  remapWelcomeCampaign,
} from '@/infrastructure/supabase/repositories/campaign-repository'
import { getOnboardingSettings } from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import { seedDefaultWelcomeCampaign } from '../seed-default-welcome-campaign'

describe('seedDefaultWelcomeCampaign', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getOnboardingSettings).mockResolvedValue({
      welcomeCampaignId: null,
      returningMemberTemplate: null,
      returningMemberTemplateEn: null,
      returningMemberTemplateZhHk: null,
      defaultLanguage: 'zh_hk',
    })
    vi.mocked(createCampaign).mockResolvedValue({
      id: 'camp-1',
      restaurantId: 'rest-1',
    } as never)
    vi.mocked(remapWelcomeCampaign).mockResolvedValue(undefined as never)
  })

  it('creates a campaign and maps it as the welcome campaign', async () => {
    const result = await seedDefaultWelcomeCampaign('rest-1')

    expect(createCampaign).toHaveBeenCalledTimes(1)
    const args = vi.mocked(createCampaign).mock.calls[0][0]
    expect(args.restaurantId).toBe('rest-1')
    expect(args.type).toBe('welcome')
    expect(args.status).toBe('active')
    expect(args.templateEn).toContain('{{couponCode}}')
    expect(args.templateZhHk).toContain('{{couponCode}}')
    expect(args.templateEn).not.toContain('{{contactName}}')

    expect(remapWelcomeCampaign).toHaveBeenCalledWith('rest-1', null, 'camp-1')
    expect(result).toEqual({ campaignId: 'camp-1' })
  })

  it('is idempotent: skips when a welcome campaign is already mapped', async () => {
    vi.mocked(getOnboardingSettings).mockResolvedValue({
      welcomeCampaignId: 'existing-camp',
      returningMemberTemplate: null,
      returningMemberTemplateEn: null,
      returningMemberTemplateZhHk: null,
      defaultLanguage: 'zh_hk',
    })

    const result = await seedDefaultWelcomeCampaign('rest-1')

    expect(createCampaign).not.toHaveBeenCalled()
    expect(remapWelcomeCampaign).not.toHaveBeenCalled()
    expect(result).toEqual({ campaignId: 'existing-camp' })
  })

  it('bubbles up repository errors from createCampaign', async () => {
    vi.mocked(createCampaign).mockRejectedValue(new Error('db down'))

    await expect(seedDefaultWelcomeCampaign('rest-1')).rejects.toThrow('db down')
    expect(remapWelcomeCampaign).not.toHaveBeenCalled()
  })

  it('flips is_chargeable via remapWelcomeCampaign (not direct column write)', async () => {
    await seedDefaultWelcomeCampaign('rest-1')

    // remapWelcomeCampaign is the atomic RPC that flips is_chargeable=false
    // on the new welcome campaign. Seeding MUST route through it, not call
    // updateCampaign({ isChargeable: false }) directly.
    expect(remapWelcomeCampaign).toHaveBeenCalledWith('rest-1', null, 'camp-1')
  })
})

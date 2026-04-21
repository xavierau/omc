import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Campaign } from '@/domain/entities/campaign'

vi.mock('@/infrastructure/supabase/repositories/restaurant-onboarding-repository')
vi.mock('@/infrastructure/supabase/repositories/campaign-repository')

import {
  getOnboardingSettings,
  updateOnboardingSettings,
} from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import {
  getCampaignById,
  setCampaignChargeable,
} from '@/infrastructure/supabase/repositories/campaign-repository'
import {
  updateOnboardingSettingsForTenant,
  OnboardingSettingsError,
} from '../update-onboarding-settings'

const RESTAURANT_ID = 'rest-1'

function buildCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 'camp-1',
    restaurantId: RESTAURANT_ID,
    name: 'Welcome',
    type: 'welcome',
    template: 'Hi',
    couponConfig: null,
    schedule: null,
    scheduledAt: null,
    status: 'active',
    isChargeable: true,
    chargeableSentCount: 0,
    nonChargeableSentCount: 0,
    redeemedCount: 0,
    whatsappTemplateId: null,
    targetAudience: 'all',
    createdAt: '2026-04-20T00:00:00Z',
    ...overrides,
  }
}

describe('updateOnboardingSettingsForTenant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(updateOnboardingSettings).mockResolvedValue(undefined)
    vi.mocked(setCampaignChargeable).mockResolvedValue(undefined)
  })

  it('rejects cross-tenant welcome campaigns with 403', async () => {
    vi.mocked(getCampaignById).mockResolvedValueOnce(
      buildCampaign({ restaurantId: 'other-tenant' })
    )

    await expect(
      updateOnboardingSettingsForTenant(RESTAURANT_ID, { welcomeCampaignId: 'camp-1' })
    ).rejects.toMatchObject({
      message: 'welcome campaign does not belong to this tenant',
      statusCode: 403,
    })
  })

  it('rejects unknown welcome campaigns with 400', async () => {
    vi.mocked(getCampaignById).mockResolvedValueOnce(null)

    await expect(
      updateOnboardingSettingsForTenant(RESTAURANT_ID, { welcomeCampaignId: 'missing' })
    ).rejects.toBeInstanceOf(OnboardingSettingsError)
  })

  it('rejects non-welcome-type campaigns (e.g. promo) with 400', async () => {
    vi.mocked(getCampaignById).mockResolvedValueOnce(
      buildCampaign({ id: 'camp-promo', type: 'promo' })
    )

    await expect(
      updateOnboardingSettingsForTenant(RESTAURANT_ID, { welcomeCampaignId: 'camp-promo' })
    ).rejects.toMatchObject({
      message: 'only welcome-type campaigns may be mapped',
      statusCode: 400,
    })
  })

  it('flips is_chargeable on both old and new when welcome campaign changes', async () => {
    vi.mocked(getCampaignById).mockResolvedValueOnce(buildCampaign({ id: 'camp-new' }))
    vi.mocked(getOnboardingSettings)
      .mockResolvedValueOnce({
        welcomeCampaignId: 'camp-old',
        returningMemberTemplate: null,
      })
      .mockResolvedValueOnce({
        welcomeCampaignId: 'camp-new',
        returningMemberTemplate: null,
      })

    await updateOnboardingSettingsForTenant(RESTAURANT_ID, {
      welcomeCampaignId: 'camp-new',
    })

    expect(setCampaignChargeable).toHaveBeenCalledWith('camp-old', true)
    expect(setCampaignChargeable).toHaveBeenCalledWith('camp-new', false)
  })

  it('flips the old campaign back to chargeable when clearing the mapping', async () => {
    vi.mocked(getOnboardingSettings)
      .mockResolvedValueOnce({
        welcomeCampaignId: 'camp-old',
        returningMemberTemplate: null,
      })
      .mockResolvedValueOnce({
        welcomeCampaignId: null,
        returningMemberTemplate: null,
      })

    await updateOnboardingSettingsForTenant(RESTAURANT_ID, {
      welcomeCampaignId: null,
    })

    expect(setCampaignChargeable).toHaveBeenCalledWith('camp-old', true)
    // No "new" flip when the mapping is cleared
    expect(setCampaignChargeable).toHaveBeenCalledTimes(1)
  })

  it('does not touch chargeability when only the returning template changes', async () => {
    vi.mocked(getOnboardingSettings).mockResolvedValue({
      welcomeCampaignId: 'camp-old',
      returningMemberTemplate: null,
    })

    await updateOnboardingSettingsForTenant(RESTAURANT_ID, {
      returningMemberTemplate: 'Hello back {{name}}',
    })

    expect(setCampaignChargeable).not.toHaveBeenCalled()
    expect(updateOnboardingSettings).toHaveBeenCalledWith(RESTAURANT_ID, {
      returningMemberTemplate: 'Hello back {{name}}',
    })
  })

  it('returns the latest settings from the repository', async () => {
    vi.mocked(getOnboardingSettings).mockResolvedValue({
      welcomeCampaignId: null,
      returningMemberTemplate: 'Hi {{name}}',
    })

    const result = await updateOnboardingSettingsForTenant(RESTAURANT_ID, {
      returningMemberTemplate: 'Hi {{name}}',
    })

    expect(result).toEqual({
      welcomeCampaignId: null,
      returningMemberTemplate: 'Hi {{name}}',
    })
  })
})

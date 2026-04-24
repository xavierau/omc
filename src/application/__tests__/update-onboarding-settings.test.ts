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
  remapWelcomeCampaign,
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
    templateEn: null,
    templateZhHk: null,
    imageUrlEn: null,
    imageUrlZhHk: null,
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
    vi.mocked(remapWelcomeCampaign).mockResolvedValue(undefined)
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

  it('remaps atomically via RPC when the welcome campaign changes', async () => {
    vi.mocked(getCampaignById).mockResolvedValueOnce(buildCampaign({ id: 'camp-new' }))
    vi.mocked(getOnboardingSettings).mockResolvedValueOnce({
      welcomeCampaignId: 'camp-old',
      returningMemberTemplate: null,
      returningMemberTemplateEn: null,
      returningMemberTemplateZhHk: null,
      defaultLanguage: 'zh_hk',
    })

    await updateOnboardingSettingsForTenant(RESTAURANT_ID, {
      welcomeCampaignId: 'camp-new',
    })

    expect(remapWelcomeCampaign).toHaveBeenCalledTimes(1)
    expect(remapWelcomeCampaign).toHaveBeenCalledWith(
      RESTAURANT_ID,
      'camp-old',
      'camp-new'
    )
    // When only the campaign changed, no separate onboarding-settings write
    // (the RPC handled welcome_campaign_id).
    expect(updateOnboardingSettings).not.toHaveBeenCalled()
  })

  it('remaps and clears chargeability via RPC when clearing the mapping', async () => {
    vi.mocked(getOnboardingSettings).mockResolvedValueOnce({
      welcomeCampaignId: 'camp-old',
      returningMemberTemplate: null,
      returningMemberTemplateEn: null,
      returningMemberTemplateZhHk: null,
      defaultLanguage: 'zh_hk',
    })

    await updateOnboardingSettingsForTenant(RESTAURANT_ID, {
      welcomeCampaignId: null,
    })

    expect(remapWelcomeCampaign).toHaveBeenCalledTimes(1)
    expect(remapWelcomeCampaign).toHaveBeenCalledWith(
      RESTAURANT_ID,
      'camp-old',
      null
    )
  })

  it('writes the template separately when both campaign and template change', async () => {
    vi.mocked(getCampaignById).mockResolvedValueOnce(buildCampaign({ id: 'camp-new' }))
    vi.mocked(getOnboardingSettings).mockResolvedValueOnce({
      welcomeCampaignId: 'camp-old',
      returningMemberTemplate: null,
      returningMemberTemplateEn: null,
      returningMemberTemplateZhHk: null,
      defaultLanguage: 'zh_hk',
    })

    await updateOnboardingSettingsForTenant(RESTAURANT_ID, {
      welcomeCampaignId: 'camp-new',
      returningMemberTemplateEn: 'Hello back {{name}}',
    })

    expect(remapWelcomeCampaign).toHaveBeenCalledWith(
      RESTAURANT_ID,
      'camp-old',
      'camp-new'
    )
    expect(updateOnboardingSettings).toHaveBeenCalledWith(RESTAURANT_ID, {
      returningMemberTemplateEn: 'Hello back {{name}}',
      legacyReturningTemplate: 'Hello back {{name}}',
    })
  })

  it('does not touch chargeability when only the returning template changes', async () => {
    vi.mocked(getOnboardingSettings).mockResolvedValueOnce({
      welcomeCampaignId: 'camp-old',
      returningMemberTemplate: null,
      returningMemberTemplateEn: null,
      returningMemberTemplateZhHk: null,
      defaultLanguage: 'zh_hk',
    })

    await updateOnboardingSettingsForTenant(RESTAURANT_ID, {
      returningMemberTemplateEn: 'Hello back {{name}}',
    })

    expect(remapWelcomeCampaign).not.toHaveBeenCalled()
    expect(updateOnboardingSettings).toHaveBeenCalledWith(RESTAURANT_ID, {
      returningMemberTemplateEn: 'Hello back {{name}}',
      legacyReturningTemplate: 'Hello back {{name}}',
    })
  })

  it('returns the merged settings without re-fetching from the repository', async () => {
    vi.mocked(getOnboardingSettings).mockResolvedValueOnce({
      welcomeCampaignId: null,
      returningMemberTemplate: null,
      returningMemberTemplateEn: null,
      returningMemberTemplateZhHk: null,
      defaultLanguage: 'zh_hk',
    })

    const result = await updateOnboardingSettingsForTenant(RESTAURANT_ID, {
      returningMemberTemplateEn: 'Hi {{name}}',
    })

    expect(result).toEqual({
      welcomeCampaignId: null,
      returningMemberTemplate: 'Hi {{name}}',
      returningMemberTemplateEn: 'Hi {{name}}',
      returningMemberTemplateZhHk: null,
      defaultLanguage: 'zh_hk',
    })
    // Only the initial "before" fetch; no post-write re-fetch.
    expect(getOnboardingSettings).toHaveBeenCalledTimes(1)
  })

  it('forwards bilingual and default_language changes together', async () => {
    vi.mocked(getOnboardingSettings).mockResolvedValueOnce({
      welcomeCampaignId: null,
      returningMemberTemplate: null,
      returningMemberTemplateEn: null,
      returningMemberTemplateZhHk: null,
      defaultLanguage: 'zh_hk',
    })

    await updateOnboardingSettingsForTenant(RESTAURANT_ID, {
      returningMemberTemplateEn: 'EN',
      returningMemberTemplateZhHk: 'ZH',
      defaultLanguage: 'en',
    })

    expect(updateOnboardingSettings).toHaveBeenCalledWith(RESTAURANT_ID, {
      returningMemberTemplateEn: 'EN',
      returningMemberTemplateZhHk: 'ZH',
      defaultLanguage: 'en',
      legacyReturningTemplate: 'EN',
    })
  })

  describe('legacy dual-write with sparse patches', () => {
    it('keeps zh_hk content in legacy when admin edits only EN (default_language=zh_hk)', async () => {
      vi.mocked(getOnboardingSettings).mockResolvedValueOnce({
        welcomeCampaignId: null,
        returningMemberTemplate: '舊中文',
        returningMemberTemplateEn: 'Old EN',
        returningMemberTemplateZhHk: '舊中文',
        defaultLanguage: 'zh_hk',
      })

      await updateOnboardingSettingsForTenant(RESTAURANT_ID, {
        returningMemberTemplateEn: 'New EN',
      })

      expect(updateOnboardingSettings).toHaveBeenCalledWith(RESTAURANT_ID, {
        returningMemberTemplateEn: 'New EN',
        legacyReturningTemplate: '舊中文',
      })
    })

    it('keeps en content in legacy when admin edits only zh_hk (default_language=en)', async () => {
      vi.mocked(getOnboardingSettings).mockResolvedValueOnce({
        welcomeCampaignId: null,
        returningMemberTemplate: 'Old EN',
        returningMemberTemplateEn: 'Old EN',
        returningMemberTemplateZhHk: '舊中文',
        defaultLanguage: 'en',
      })

      await updateOnboardingSettingsForTenant(RESTAURANT_ID, {
        returningMemberTemplateZhHk: '新中文',
      })

      expect(updateOnboardingSettings).toHaveBeenCalledWith(RESTAURANT_ID, {
        returningMemberTemplateZhHk: '新中文',
        legacyReturningTemplate: 'Old EN',
      })
    })

    it('switches legacy to EN content when default_language flips from zh_hk to en', async () => {
      vi.mocked(getOnboardingSettings).mockResolvedValueOnce({
        welcomeCampaignId: null,
        returningMemberTemplate: '舊中文',
        returningMemberTemplateEn: 'Old EN',
        returningMemberTemplateZhHk: '舊中文',
        defaultLanguage: 'zh_hk',
      })

      await updateOnboardingSettingsForTenant(RESTAURANT_ID, {
        defaultLanguage: 'en',
      })

      expect(updateOnboardingSettings).toHaveBeenCalledWith(RESTAURANT_ID, {
        defaultLanguage: 'en',
        legacyReturningTemplate: 'Old EN',
      })
    })

    it('does not touch the legacy column when only welcomeCampaignId changes', async () => {
      vi.mocked(getCampaignById).mockResolvedValueOnce(
        buildCampaign({ id: 'camp-new' })
      )
      vi.mocked(getOnboardingSettings).mockResolvedValueOnce({
        welcomeCampaignId: 'camp-old',
        returningMemberTemplate: '舊中文',
        returningMemberTemplateEn: 'Old EN',
        returningMemberTemplateZhHk: '舊中文',
        defaultLanguage: 'zh_hk',
      })

      await updateOnboardingSettingsForTenant(RESTAURANT_ID, {
        welcomeCampaignId: 'camp-new',
      })

      expect(updateOnboardingSettings).not.toHaveBeenCalled()
    })
  })
})

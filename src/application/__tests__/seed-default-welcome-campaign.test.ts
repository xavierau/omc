import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/campaign-repository')
vi.mock('@/infrastructure/supabase/repositories/restaurant-onboarding-repository')

import {
  createCampaign,
  findExistingPausedWelcome,
  remapWelcomeCampaign,
  updateCampaign,
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
    vi.mocked(findExistingPausedWelcome).mockResolvedValue(null)
    vi.mocked(createCampaign).mockResolvedValue({
      id: 'camp-1',
      restaurantId: 'rest-1',
    } as never)
    vi.mocked(remapWelcomeCampaign).mockResolvedValue(undefined as never)
    vi.mocked(updateCampaign).mockResolvedValue({ id: 'camp-1' } as never)
  })

  it('creates a campaign and maps it as the welcome campaign', async () => {
    const result = await seedDefaultWelcomeCampaign('rest-1')

    expect(createCampaign).toHaveBeenCalledTimes(1)
    const args = vi.mocked(createCampaign).mock.calls[0][0]
    expect(args.restaurantId).toBe('rest-1')
    expect(args.type).toBe('welcome')
    // Campaign is created PAUSED so the active partial-unique index can't
    // trip mid-seed; activation is a follow-up step after the remap RPC.
    expect(args.status).toBe('paused')
    expect(args.templateEn).toContain('{{couponCode}}')
    expect(args.templateZhHk).toContain('{{couponCode}}')
    expect(args.templateEn).not.toContain('{{contactName}}')
    // legacyTemplate populates the legacy `template` column for
    // rolling-deploy readers — must stay in sync with zh-HK content
    // when defaultLanguage is zh_hk.
    expect(args.legacyTemplate).toContain('{{couponCode}}')
    expect(args.legacyTemplate).toContain('歡迎')

    expect(remapWelcomeCampaign).toHaveBeenCalledWith('rest-1', null, 'camp-1')
    // After remap succeeds, the campaign is flipped to active.
    expect(updateCampaign).toHaveBeenCalledWith('camp-1', { status: 'active' })
    expect(result).toEqual({ campaignId: 'camp-1' })
  })

  it('uses English legacyTemplate when defaultLanguage is en', async () => {
    vi.mocked(getOnboardingSettings).mockResolvedValue({
      welcomeCampaignId: null,
      returningMemberTemplate: null,
      returningMemberTemplateEn: null,
      returningMemberTemplateZhHk: null,
      defaultLanguage: 'en',
    })

    await seedDefaultWelcomeCampaign('rest-1')

    const args = vi.mocked(createCampaign).mock.calls[0][0]
    expect(args.legacyTemplate).toContain('Welcome')
    expect(args.legacyTemplate).not.toContain('歡迎')
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
    expect(updateCampaign).not.toHaveBeenCalled()
    expect(result).toEqual({ campaignId: 'existing-camp' })
  })

  it('bubbles up repository errors from createCampaign', async () => {
    vi.mocked(createCampaign).mockRejectedValue(new Error('db down'))

    await expect(seedDefaultWelcomeCampaign('rest-1')).rejects.toThrow('db down')
    expect(remapWelcomeCampaign).not.toHaveBeenCalled()
    expect(updateCampaign).not.toHaveBeenCalled()
  })

  it('does NOT activate the campaign if remap fails (atomicity)', async () => {
    vi.mocked(remapWelcomeCampaign).mockRejectedValue(new Error('remap RPC failed'))

    await expect(seedDefaultWelcomeCampaign('rest-1')).rejects.toThrow('remap RPC failed')
    // The orphan stays paused so the active partial-unique index isn't
    // poisoned. We MUST NOT have flipped it to active.
    expect(updateCampaign).not.toHaveBeenCalled()
  })

  it('reuses an existing paused welcome on retry (no orphan accumulation)', async () => {
    // Attempt 1: createCampaign succeeds, remap fails. Paused row sticks.
    vi.mocked(remapWelcomeCampaign).mockRejectedValueOnce(
      new Error('remap RPC failed')
    )
    await expect(seedDefaultWelcomeCampaign('rest-1')).rejects.toThrow(
      'remap RPC failed'
    )
    expect(createCampaign).toHaveBeenCalledTimes(1)

    // Attempt 2: simulate the lookup finding the paused row from attempt 1.
    vi.mocked(findExistingPausedWelcome).mockResolvedValueOnce({ id: 'camp-1' })
    vi.mocked(remapWelcomeCampaign).mockResolvedValueOnce(undefined as never)

    const result = await seedDefaultWelcomeCampaign('rest-1')

    // The crucial invariant: createCampaign is NOT called a second time —
    // the seeder reused the paused row from attempt 1.
    expect(createCampaign).toHaveBeenCalledTimes(1)
    expect(remapWelcomeCampaign).toHaveBeenLastCalledWith('rest-1', null, 'camp-1')
    expect(updateCampaign).toHaveBeenLastCalledWith('camp-1', { status: 'active' })
    expect(result).toEqual({ campaignId: 'camp-1' })
  })

  it('flips is_chargeable via remapWelcomeCampaign (not direct column write)', async () => {
    await seedDefaultWelcomeCampaign('rest-1')

    // remapWelcomeCampaign is the atomic RPC that flips is_chargeable=false
    // on the new welcome campaign. Seeding MUST route through it, not call
    // updateCampaign({ isChargeable: false }) directly.
    expect(remapWelcomeCampaign).toHaveBeenCalledWith('rest-1', null, 'camp-1')
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/restaurant-onboarding-repository', () => ({
  getRestaurantDefaultLanguage: vi.fn(),
}))

import { resolveLanguageForMember } from '../resolve-language'
import { Language } from '@/domain/value-objects/language'
import { getRestaurantDefaultLanguage } from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'

describe('resolveLanguageForMember', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns member.preferredLanguage when set (en)', async () => {
    vi.mocked(getRestaurantDefaultLanguage).mockResolvedValue('zh_hk')

    const lang = await resolveLanguageForMember(
      { preferredLanguage: 'en' },
      'rest-1'
    )

    expect(lang).toBe(Language.EN)
  })

  it('returns member.preferredLanguage when set (zh_hk)', async () => {
    vi.mocked(getRestaurantDefaultLanguage).mockResolvedValue('en')

    const lang = await resolveLanguageForMember(
      { preferredLanguage: 'zh_hk' },
      'rest-1'
    )

    expect(lang).toBe(Language.ZH_HK)
  })

  it('falls back to restaurant default when member has no preference', async () => {
    vi.mocked(getRestaurantDefaultLanguage).mockResolvedValue('zh_hk')

    const lang = await resolveLanguageForMember(
      { preferredLanguage: null },
      'rest-1'
    )

    expect(lang).toBe(Language.ZH_HK)
  })

  it('falls back to restaurant default when member is null (non-member)', async () => {
    vi.mocked(getRestaurantDefaultLanguage).mockResolvedValue('zh_hk')

    const lang = await resolveLanguageForMember(null, 'rest-1')

    expect(lang).toBe(Language.ZH_HK)
  })

  it('falls back to Language.default() when restaurant default is null and member has no preference', async () => {
    vi.mocked(getRestaurantDefaultLanguage).mockResolvedValue(null as unknown as 'en')

    const lang = await resolveLanguageForMember(
      { preferredLanguage: null },
      'rest-1'
    )

    expect(lang).toBe(Language.default())
  })

  it('looks up the restaurant default using the given restaurantId', async () => {
    vi.mocked(getRestaurantDefaultLanguage).mockResolvedValue('en')

    await resolveLanguageForMember(null, 'rest-42')

    expect(getRestaurantDefaultLanguage).toHaveBeenCalledWith('rest-42')
  })
})

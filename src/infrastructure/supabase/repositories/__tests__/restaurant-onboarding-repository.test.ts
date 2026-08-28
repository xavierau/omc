import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import {
  getOnboardingSettings,
  getRestaurantDefaultLanguage,
  updateOnboardingSettings,
} from '../restaurant-onboarding-repository'

function buildSelectMock(
  row: Record<string, unknown> | null,
  error: { message: string } | null = null
) {
  const single = vi.fn().mockResolvedValue({ data: row, error })
  const eq = vi.fn().mockReturnValue({ single })
  const select = vi.fn().mockReturnValue({ eq })
  const from = vi.fn().mockReturnValue({ select })
  return { from, select, eq, single }
}

function buildUpdateMock(error: { message: string } | null = null) {
  const eq = vi.fn().mockResolvedValue({ error })
  const update = vi.fn().mockReturnValue({ eq })
  const from = vi.fn().mockReturnValue({ update })
  return { from, update, eq }
}

describe('getOnboardingSettings', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns all fields including bilingual + defaultLanguage when present', async () => {
    const m = buildSelectMock({
      welcome_campaign_id: 'camp-1',
      returning_member_template: 'legacy',
      returning_member_template_en: 'Welcome back {{name}}',
      returning_member_template_zh_hk: '歡迎回來 {{name}}',
      default_language: 'en',
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: m.from } as never)

    const result = await getOnboardingSettings('rest-1')

    expect(result).toEqual({
      welcomeCampaignId: 'camp-1',
      returningMemberTemplate: 'legacy',
      returningMemberTemplateEn: 'Welcome back {{name}}',
      returningMemberTemplateZhHk: '歡迎回來 {{name}}',
      defaultLanguage: 'en',
    })
  })

  it('returns nulls for unset fields and defaults language to zh_hk', async () => {
    const m = buildSelectMock({
      welcome_campaign_id: null,
      returning_member_template: null,
      returning_member_template_en: null,
      returning_member_template_zh_hk: null,
      default_language: 'zh_hk',
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: m.from } as never)

    const result = await getOnboardingSettings('rest-1')

    expect(result).toEqual({
      welcomeCampaignId: null,
      returningMemberTemplate: null,
      returningMemberTemplateEn: null,
      returningMemberTemplateZhHk: null,
      defaultLanguage: 'zh_hk',
    })
  })

  it('throws when the restaurant is not found', async () => {
    const m = buildSelectMock(null, { message: 'not found' })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: m.from } as never)

    await expect(getOnboardingSettings('missing')).rejects.toThrow(
      'restaurant not found'
    )
  })
})

describe('getRestaurantDefaultLanguage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the configured language', async () => {
    const m = buildSelectMock({ default_language: 'en' })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: m.from } as never)
    expect(await getRestaurantDefaultLanguage('rest-1')).toBe('en')
  })

  it('defaults to zh_hk when missing', async () => {
    const m = buildSelectMock(null, { message: 'not found' })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: m.from } as never)
    expect(await getRestaurantDefaultLanguage('rest-1')).toBe('zh_hk')
  })
})

describe('updateOnboardingSettings', () => {
  beforeEach(() => vi.clearAllMocks())

  it('writes only welcome_campaign_id when that is the only change', async () => {
    const m = buildUpdateMock()
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: m.from } as never)

    await updateOnboardingSettings('rest-1', { welcomeCampaignId: 'camp-2' })

    expect(m.update).toHaveBeenCalledWith({ welcome_campaign_id: 'camp-2' })
  })

  it('writes the bilingual zh_hk field without touching the legacy column by default', async () => {
    const m = buildUpdateMock()
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: m.from } as never)

    await updateOnboardingSettings('rest-1', {
      returningMemberTemplateZhHk: '歡迎回來',
    })

    expect(m.update).toHaveBeenCalledWith({
      returning_member_template_zh_hk: '歡迎回來',
    })
  })

  it('writes the bilingual en field without touching the legacy column by default', async () => {
    const m = buildUpdateMock()
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: m.from } as never)

    await updateOnboardingSettings('rest-1', {
      returningMemberTemplateEn: 'Hi {{name}}',
    })

    expect(m.update).toHaveBeenCalledWith({
      returning_member_template_en: 'Hi {{name}}',
    })
  })

  it('writes the explicit legacyReturningTemplate value it is given', async () => {
    const m = buildUpdateMock()
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: m.from } as never)

    await updateOnboardingSettings('rest-1', {
      returningMemberTemplateEn: 'EN',
      returningMemberTemplateZhHk: 'ZH',
      legacyReturningTemplate: 'ZH',
    })

    expect(m.update).toHaveBeenCalledWith({
      returning_member_template_en: 'EN',
      returning_member_template_zh_hk: 'ZH',
      returning_member_template: 'ZH',
    })
  })

  it('honours an explicit null legacyReturningTemplate (clears legacy column)', async () => {
    const m = buildUpdateMock()
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: m.from } as never)

    await updateOnboardingSettings('rest-1', {
      returningMemberTemplateEn: null,
      returningMemberTemplateZhHk: null,
      legacyReturningTemplate: null,
    })

    expect(m.update).toHaveBeenCalledWith({
      returning_member_template_en: null,
      returning_member_template_zh_hk: null,
      returning_member_template: null,
    })
  })

  it('writes default_language when that field changes', async () => {
    const m = buildUpdateMock()
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: m.from } as never)

    await updateOnboardingSettings('rest-1', { defaultLanguage: 'en' })

    expect(m.update).toHaveBeenCalledWith({ default_language: 'en' })
  })

  it('writes null to clear a welcome campaign mapping', async () => {
    const m = buildUpdateMock()
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: m.from } as never)

    await updateOnboardingSettings('rest-1', { welcomeCampaignId: null })

    expect(m.update).toHaveBeenCalledWith({ welcome_campaign_id: null })
  })

  it('is a no-op when no changes are provided', async () => {
    const m = buildUpdateMock()
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: m.from } as never)

    await updateOnboardingSettings('rest-1', {})

    expect(m.from).not.toHaveBeenCalled()
  })

  it('throws when the update fails', async () => {
    const m = buildUpdateMock({ message: 'boom' })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: m.from } as never)

    await expect(
      updateOnboardingSettings('rest-1', { welcomeCampaignId: 'c1' })
    ).rejects.toThrow('boom')
  })
})

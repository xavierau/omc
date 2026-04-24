import { describe, it, expect } from 'vitest'
import { Language } from '@/domain/value-objects/language'
import type { Campaign } from '@/domain/entities/campaign'
import type { OnboardingSettings } from '@/domain/onboarding/onboarding-settings'
import {
  resolveCampaignTemplate,
  resolveReturningMemberTemplate,
} from '../resolve-campaign-template'

function campaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 'c-1',
    restaurantId: 'r-1',
    name: 'n',
    type: 'promo',
    template: 'LEG',
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

function settings(overrides: Partial<OnboardingSettings> = {}): OnboardingSettings {
  return {
    welcomeCampaignId: null,
    returningMemberTemplate: null,
    returningMemberTemplateEn: null,
    returningMemberTemplateZhHk: null,
    defaultLanguage: 'zh_hk',
    ...overrides,
  }
}

describe('resolveCampaignTemplate', () => {
  it('returns preferred EN', () => {
    const c = campaign({ templateEn: 'EN', templateZhHk: 'ZH', template: 'LEG' })
    expect(resolveCampaignTemplate(c, Language.EN)).toBe('EN')
  })

  it('falls back to other language when preferred missing', () => {
    const c = campaign({ templateEn: null, templateZhHk: 'ZH', template: 'LEG' })
    expect(resolveCampaignTemplate(c, Language.EN)).toBe('ZH')
  })

  it('falls back to legacy template when both languages empty', () => {
    const c = campaign({ templateEn: null, templateZhHk: null, template: 'LEG' })
    expect(resolveCampaignTemplate(c, Language.ZH_HK)).toBe('LEG')
  })

  it('returns null when everything is empty', () => {
    const c = campaign({ templateEn: null, templateZhHk: null, template: '' })
    expect(resolveCampaignTemplate(c, Language.EN)).toBeNull()
  })
})

describe('resolveReturningMemberTemplate', () => {
  it('returns preferred ZH', () => {
    const s = settings({
      returningMemberTemplateEn: 'EN',
      returningMemberTemplateZhHk: '你好',
      returningMemberTemplate: 'LEG',
    })
    expect(resolveReturningMemberTemplate(s, Language.ZH_HK)).toBe('你好')
  })

  it('falls back to legacy when both languages null', () => {
    const s = settings({ returningMemberTemplate: 'LEG' })
    expect(resolveReturningMemberTemplate(s, Language.EN)).toBe('LEG')
  })

  it('returns null when nothing set', () => {
    expect(resolveReturningMemberTemplate(settings(), Language.EN)).toBeNull()
  })
})

import { describe, it, expect } from 'vitest'
import {
  buildCampaignUpdateRow,
  legacyTemplateFromBilingual,
} from '../campaign-mapper'

describe('buildCampaignUpdateRow', () => {
  it('writes bilingual fields without touching the legacy column by default', () => {
    const row = buildCampaignUpdateRow({ templateEn: 'Hi', templateZhHk: '你好' })
    expect(row).toEqual({ template_en: 'Hi', template_zh_hk: '你好' })
    expect('template' in row).toBe(false)
  })

  it('only changes the legacy column when an explicit legacyTemplate is supplied', () => {
    const row = buildCampaignUpdateRow({
      templateEn: 'Hi',
      templateZhHk: '你好',
      legacyTemplate: '你好',
    })
    expect(row).toEqual({
      template_en: 'Hi',
      template_zh_hk: '你好',
      template: '你好',
    })
  })

  it('honours an explicit legacyTemplate even when no bilingual field changes', () => {
    const row = buildCampaignUpdateRow({ legacyTemplate: 'keep-me' })
    expect(row).toEqual({ template: 'keep-me' })
  })

  it('still accepts a direct template write (legacy callers)', () => {
    const row = buildCampaignUpdateRow({ template: 'LegacyOnly' })
    expect(row).toEqual({ template: 'LegacyOnly' })
  })

  it('omits the legacy column when only name changes', () => {
    const row = buildCampaignUpdateRow({ name: 'Rename' })
    expect(row).toEqual({ name: 'Rename' })
  })
})

describe('legacyTemplateFromBilingual (create path)', () => {
  it('prefers zh_hk over en when both are provided', () => {
    expect(legacyTemplateFromBilingual(undefined, 'EN', 'ZH')).toBe('ZH')
  })

  it('falls back to en when zh_hk is missing', () => {
    expect(legacyTemplateFromBilingual(undefined, 'EN', null)).toBe('EN')
  })

  it('returns empty string when both bilingual fields are missing', () => {
    expect(legacyTemplateFromBilingual(undefined, null, null)).toBe('')
  })

  it('explicit template wins over bilingual values', () => {
    expect(legacyTemplateFromBilingual('EXPLICIT', 'EN', 'ZH')).toBe('EXPLICIT')
  })
})

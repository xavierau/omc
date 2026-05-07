import { describe, it, expect } from 'vitest'
import { buildCampaignUpdateRow, mapRowToCampaign } from '../campaign-mapper'

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

  it('writes bilingual image URL columns when provided', () => {
    const row = buildCampaignUpdateRow({
      imageUrlEn: 'https://cdn.test/en.jpg',
      imageUrlZhHk: 'https://cdn.test/zh.jpg',
    })
    expect(row).toEqual({
      image_url_en: 'https://cdn.test/en.jpg',
      image_url_zh_hk: 'https://cdn.test/zh.jpg',
    })
  })

  it('writes null image URLs when caller clears them', () => {
    const row = buildCampaignUpdateRow({ imageUrlEn: null, imageUrlZhHk: null })
    expect(row).toEqual({ image_url_en: null, image_url_zh_hk: null })
  })

  it('does not touch image columns when fields are undefined', () => {
    const row = buildCampaignUpdateRow({ name: 'x' })
    expect('image_url_en' in row).toBe(false)
    expect('image_url_zh_hk' in row).toBe(false)
  })
})

describe('mapRowToCampaign mode (WONB-008)', () => {
  const baseRow = {
    id: 'c-1',
    restaurant_id: 'r-1',
    name: 'n',
    type: 'welcome',
    template: '',
    status: 'active',
    target_audience: 'all',
    created_at: '2026-04-20T00:00:00Z',
  }

  it('maps mode=marketing through (camelCase)', () => {
    const c = mapRowToCampaign({ ...baseRow, mode: 'marketing' })
    expect(c.mode).toBe('marketing')
  })

  it('maps mode=reconfirmation through (camelCase)', () => {
    const c = mapRowToCampaign({ ...baseRow, mode: 'reconfirmation' })
    expect(c.mode).toBe('reconfirmation')
  })

  it("defaults missing mode column to 'marketing' (back-compat for old rows)", () => {
    const c = mapRowToCampaign(baseRow)
    expect(c.mode).toBe('marketing')
  })

  it("defaults unknown mode value to 'marketing' (defends the union)", () => {
    const c = mapRowToCampaign({ ...baseRow, mode: 'banana' })
    expect(c.mode).toBe('marketing')
  })
})

describe('buildCampaignUpdateRow mode (WONB-008)', () => {
  it('writes mode=reconfirmation when supplied', () => {
    const row = buildCampaignUpdateRow({ mode: 'reconfirmation' })
    expect(row).toEqual({ mode: 'reconfirmation' })
  })

  it('writes mode=marketing when supplied', () => {
    const row = buildCampaignUpdateRow({ mode: 'marketing' })
    expect(row).toEqual({ mode: 'marketing' })
  })

  it('does not touch mode when undefined (sparse PATCH)', () => {
    const row = buildCampaignUpdateRow({ name: 'x' })
    expect('mode' in row).toBe(false)
  })
})

describe('mapRowToCampaign image fields', () => {
  it('maps image_url_en and image_url_zh_hk into camelCase', () => {
    const campaign = mapRowToCampaign({
      id: 'c-1',
      restaurant_id: 'r-1',
      name: 'n',
      type: 'welcome',
      template: '',
      template_en: null,
      template_zh_hk: null,
      image_url_en: 'https://cdn.test/en.jpg',
      image_url_zh_hk: 'https://cdn.test/zh.jpg',
      coupon_config: null,
      schedule: null,
      scheduled_at: null,
      status: 'active',
      is_chargeable: false,
      chargeable_sent_count: 0,
      non_chargeable_sent_count: 0,
      redeemed_count: 0,
      whatsapp_template_id: null,
      target_audience: 'all',
      created_at: '2026-04-20T00:00:00Z',
    })
    expect(campaign.imageUrlEn).toBe('https://cdn.test/en.jpg')
    expect(campaign.imageUrlZhHk).toBe('https://cdn.test/zh.jpg')
  })

  it('defaults missing image columns to null', () => {
    const campaign = mapRowToCampaign({
      id: 'c-1',
      restaurant_id: 'r-1',
      name: 'n',
      type: 'welcome',
      template: '',
      status: 'active',
      target_audience: 'all',
      created_at: '2026-04-20T00:00:00Z',
    })
    expect(campaign.imageUrlEn).toBeNull()
    expect(campaign.imageUrlZhHk).toBeNull()
  })
})

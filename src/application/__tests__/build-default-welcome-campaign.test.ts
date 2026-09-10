import { describe, it, expect } from 'vitest'
import { buildDefaultWelcomeCampaign } from '../build-default-welcome-campaign'

describe('buildDefaultWelcomeCampaign', () => {
  const fixture = buildDefaultWelcomeCampaign({ restaurantId: 'rest-1' })

  it('emits a welcome-type active campaign with the restaurant id', () => {
    expect(fixture.restaurantId).toBe('rest-1')
    expect(fixture.type).toBe('welcome')
    expect(fixture.status).toBe('active')
    expect(fixture.name).toBe('Default Welcome Campaign')
  })

  it('includes bilingual template copy for EN and zh-HK', () => {
    expect(fixture.templateEn.length).toBeGreaterThan(0)
    expect(fixture.templateZhHk.length).toBeGreaterThan(0)
    expect(fixture.templateEn).toContain('Welcome')
    expect(fixture.templateZhHk).toContain('歡迎')
  })

  it('uses double-brace placeholder for couponCode; omits contactName to avoid empty-name rendering quirks', () => {
    expect(fixture.templateEn).toContain('{{couponCode}}')
    expect(fixture.templateZhHk).toContain('{{couponCode}}')
    expect(fixture.templateEn).not.toContain('{{contactName}}')
    expect(fixture.templateZhHk).not.toContain('{{contactName}}')
    expect(fixture.templateEn).not.toContain('${')
    expect(fixture.templateZhHk).not.toContain('${')
  })

  it('uses 查詢積分 (matching the runtime fallback in onboarding-defaults.ts) not 查詢餘額', () => {
    expect(fixture.templateZhHk).toContain('查詢積分')
    expect(fixture.templateZhHk).not.toContain('查詢餘額')
  })

  it('configures a sensible default coupon (10% off, 30-day expiry)', () => {
    expect(fixture.couponConfig).toEqual({
      discountType: 'percentage',
      discountValue: 10,
      expiresInDays: 30,
    })
  })
})

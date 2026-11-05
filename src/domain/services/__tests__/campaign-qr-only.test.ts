import { describe, it, expect } from 'vitest'
import { isQrOnlyCouponCampaign } from '../campaign-qr-only'
import { buildWhatsAppTemplate } from '@/test-utils/builders'
import type { TemplateComponent } from '@/domain/entities/whatsapp-template'

const IMAGE_HEADER: TemplateComponent = { type: 'HEADER', format: 'IMAGE' }
const PLAIN_BODY: TemplateComponent = { type: 'BODY', text: '出示以下優惠QR碼' }

function template(components: TemplateComponent[]) {
  return buildWhatsAppTemplate({ components })
}

function rule(components: TemplateComponent[], overrides: { type?: string; hasCouponConfig?: boolean } = {}) {
  return isQrOnlyCouponCampaign({
    type: overrides.type ?? 'promo',
    hasCouponConfig: overrides.hasCouponConfig ?? true,
    template: template(components),
  })
}

describe('qr-only coupon rule (CAMP-014)', () => {
  it('nov_promo_2026 shape: IMAGE header, no buttons, no variables, coupon config', () => {
    expect(rule([IMAGE_HEADER, PLAIN_BODY])).toBe(true)
  })

  it('a quick-reply (claim) template is not qr-only', () => {
    expect(
      rule([PLAIN_BODY, { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Claim' }] }])
    ).toBe(false)
  })

  it('{{code}} in the body carries the code', () => {
    expect(rule([{ type: 'BODY', text: 'Use {{code}}' }])).toBe(false)
  })

  it('{{couponCode}} in the body carries the code', () => {
    expect(rule([{ type: 'BODY', text: 'Use {{couponCode}}' }])).toBe(false)
  })

  it('a dynamic URL button carries the code', () => {
    expect(
      rule([
        PLAIN_BODY,
        { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Use', url: 'https://x.test/{{1}}' }] },
      ])
    ).toBe(false)
  })

  it('a COPY_CODE button carries the code', () => {
    expect(rule([PLAIN_BODY, { type: 'BUTTONS', buttons: [{ type: 'COPY_CODE', text: 'Copy' }] }])).toBe(false)
  })

  it('{{discount}} alone does not carry a code', () => {
    expect(rule([{ type: 'BODY', text: 'Enjoy {{discount}} off' }])).toBe(true)
  })

  it('a static URL button does not carry a code', () => {
    expect(
      rule([
        PLAIN_BODY,
        { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Menu', url: 'https://x.test/menu' }] },
      ])
    ).toBe(true)
  })

  it('no coupon config means no code to lose', () => {
    expect(rule([IMAGE_HEADER, PLAIN_BODY], { hasCouponConfig: false })).toBe(false)
  })

  it('a welcome campaign has an open window, so it is not qr-only', () => {
    expect(rule([IMAGE_HEADER, PLAIN_BODY], { type: 'welcome' })).toBe(false)
  })

  it('a null template (inline campaign) is out of scope', () => {
    expect(
      isQrOnlyCouponCampaign({ type: 'promo', hasCouponConfig: true, template: null })
    ).toBe(false)
  })
})

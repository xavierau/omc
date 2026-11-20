// BOOK-001 W3: the pre-send coupon guard reads the app URL, so a coupon-less
// campaign whose template has only a Book now button is sendable, while a
// coupon URL button still needs a coupon.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { enforceCouponParams } from '../enforce-coupon-params'
import { buildCampaign, buildWhatsAppTemplate } from '@/test-utils/builders'
import type { TemplateButton } from '@/domain/entities/whatsapp-template'

const APP = 'https://app.ohmyclient.io'
const tpl = (buttons: TemplateButton[]) =>
  buildWhatsAppTemplate({ components: [{ type: 'BODY', text: 'Hi' }, { type: 'BUTTONS', buttons }] })

afterEach(() => vi.unstubAllEnvs())

describe('enforceCouponParams with a Book now button', () => {
  it('lets a coupon-less Book now campaign through', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', APP)
    const template = tpl([{ type: 'URL', text: 'Book now', url: `${APP}/b/{{1}}` }])
    expect(() => enforceCouponParams(buildCampaign({ couponConfig: null, bookNowEnabled: true }), template)).not.toThrow()
  })

  it('still refuses a coupon-less campaign with a coupon URL button', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', APP)
    const template = tpl([{ type: 'URL', text: 'Coupon', url: `${APP}/coupon/{{1}}` }])
    expect(() => enforceCouponParams(buildCampaign({ couponConfig: null }), template)).toThrow(/coupon/)
  })
})

// BOOK-001 W3 (AC-16): the Book now button is a dynamic URL button whose URL is
// exactly `${APP_URL}/b/{{1}}`. It is told apart from a coupon URL button by
// that URL, never by position, and it never makes a template "need a coupon".
import { describe, it, expect } from 'vitest'
import {
  bookNowButtonUrl,
  bookNowExampleUrl,
  isBookNowButton,
  isCouponUrlButton,
  templateHasBookNowButton,
} from '../book-now-button'
import { templateExpectsCouponCode } from '../campaign-mode'
import { couponRequirement } from '../coupon-requirement'
import { isQrOnlyCouponCampaign } from '../campaign-qr-only'
import { buildWhatsAppTemplate } from '@/test-utils/builders'
import type { TemplateButton } from '@/domain/entities/whatsapp-template'

const APP = 'https://app.ohmyclient.io'
const bookNow: TemplateButton = { type: 'URL', text: 'Book now', url: `${APP}/b/{{1}}` }
const coupon: TemplateButton = { type: 'URL', text: 'Get coupon', url: `${APP}/coupon/{{1}}` }

const withButtons = (buttons: TemplateButton[], body = 'Hi {{customer_name}}') =>
  buildWhatsAppTemplate({ components: [{ type: 'BODY', text: body }, { type: 'BUTTONS', buttons }] })

describe('book-now button identity', () => {
  it('builds the button URL from the app URL, ignoring a trailing slash', () => {
    expect(bookNowButtonUrl(APP)).toBe(`${APP}/b/{{1}}`)
    expect(bookNowButtonUrl(`${APP}/`)).toBe(`${APP}/b/{{1}}`)
    expect(bookNowExampleUrl(APP)).toMatch(new RegExp(`^${APP}/b/[A-Za-z0-9_-]+$`))
  })

  it('matches only the exact app URL, not a look-alike on another host', () => {
    expect(isBookNowButton(bookNow, APP)).toBe(true)
    expect(isBookNowButton({ ...bookNow, url: 'https://evil.example/b/{{1}}' }, APP)).toBe(false)
    expect(isBookNowButton({ ...bookNow, type: 'QUICK_REPLY' }, APP)).toBe(false)
    expect(isBookNowButton(coupon, APP)).toBe(false)
  })

  it('a coupon URL button is any dynamic URL button that is not Book now', () => {
    expect(isCouponUrlButton(coupon, APP)).toBe(true)
    expect(isCouponUrlButton(bookNow, APP)).toBe(false)
    expect(isCouponUrlButton({ type: 'URL', text: 'Menu', url: 'https://x.example/menu' }, APP)).toBe(false)
  })

  it('finds the button wherever it sits in the BUTTONS component', () => {
    expect(templateHasBookNowButton(withButtons([coupon, bookNow]), APP)).toBe(true)
    expect(templateHasBookNowButton(withButtons([coupon]), APP)).toBe(false)
    expect(templateHasBookNowButton(null, APP)).toBe(false)
  })
})

describe('a Book now button does not make a template need a coupon', () => {
  it('templateExpectsCouponCode: Book now only → false; with a coupon button → true', () => {
    expect(templateExpectsCouponCode(withButtons([bookNow]), APP)).toBe(false)
    expect(templateExpectsCouponCode(withButtons([bookNow, coupon]), APP)).toBe(true)
  })

  it('couponRequirement: a coupon-less Book now campaign is marketing-only, not blocked', () => {
    expect(
      couponRequirement({ hasCouponConfig: false, template: withButtons([bookNow]), inlineTexts: [], appUrl: APP })
    ).toEqual({ kind: 'marketing_only' })
  })

  it('isQrOnlyCouponCampaign: a Book now button does not carry the coupon code', () => {
    expect(
      isQrOnlyCouponCampaign({ type: 'promo', hasCouponConfig: true, template: withButtons([bookNow]), appUrl: APP })
    ).toBe(true)
    expect(
      isQrOnlyCouponCampaign({ type: 'promo', hasCouponConfig: true, template: withButtons([bookNow, coupon]), appUrl: APP })
    ).toBe(false)
  })
})

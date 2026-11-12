// BOOK-001 W3 (AC-16): the Book now button is a dynamic URL button whose URL is
// an https link whose path ends exactly with `/b/{{1}}`. It is told apart from
// a coupon URL button by that path, never by position, and it never makes a
// template "need a coupon". F3 (review S-1): no app-URL equality, so a worker
// whose NEXT_PUBLIC_APP_URL is unset or differs still finds it.
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

  it('matches an https URL whose path ends exactly with /b/{{1}}, on any host', () => {
    expect(isBookNowButton(bookNow)).toBe(true)
    expect(isBookNowButton({ ...bookNow, url: 'https://old-domain.example/b/{{1}}' })).toBe(true)
    expect(isBookNowButton({ ...bookNow, url: 'https://app.example/tenant/b/{{1}}' })).toBe(true)
    for (const url of ['http://app.example/b/{{1}}', 'https:///b/{{1}}', '/b/{{1}}', 'https://app.example/b/{{1}}/x',
      'https://app.example/b/{{1}}?x=1', 'https://app.example/book/{{1}}', 'https://app.example/b/{{2}}', 'https://app.example/xb/{{1}}']) {
      expect(isBookNowButton({ ...bookNow, url }), url).toBe(false)
    }
    expect(isBookNowButton({ ...bookNow, type: 'QUICK_REPLY' })).toBe(false)
    expect(isBookNowButton(coupon)).toBe(false)
  })

  it('a coupon URL button is any dynamic URL button that is not Book now', () => {
    expect(isCouponUrlButton(coupon)).toBe(true)
    expect(isCouponUrlButton(bookNow)).toBe(false)
    expect(isCouponUrlButton({ type: 'URL', text: 'Menu', url: 'https://x.example/menu' })).toBe(false)
  })

  it('finds the button wherever it sits in the BUTTONS component', () => {
    expect(templateHasBookNowButton(withButtons([coupon, bookNow]))).toBe(true)
    expect(templateHasBookNowButton(withButtons([coupon]))).toBe(false)
    expect(templateHasBookNowButton(null)).toBe(false)
  })
})

describe('a Book now button does not make a template need a coupon', () => {
  it('templateExpectsCouponCode: Book now only → false; with a coupon button → true', () => {
    expect(templateExpectsCouponCode(withButtons([bookNow]))).toBe(false)
    expect(templateExpectsCouponCode(withButtons([bookNow, coupon]))).toBe(true)
  })

  it('couponRequirement: a coupon-less Book now campaign is marketing-only, not blocked', () => {
    expect(
      couponRequirement({ hasCouponConfig: false, template: withButtons([bookNow]), inlineTexts: [] })
    ).toEqual({ kind: 'marketing_only' })
  })

  it('isQrOnlyCouponCampaign: a Book now button does not carry the coupon code', () => {
    expect(
      isQrOnlyCouponCampaign({ type: 'promo', hasCouponConfig: true, template: withButtons([bookNow]) })
    ).toBe(true)
    expect(
      isQrOnlyCouponCampaign({ type: 'promo', hasCouponConfig: true, template: withButtons([bookNow, coupon]) })
    ).toBe(false)
  })
})

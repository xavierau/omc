import {
  isDynamicUrlButton,
  type TemplateButton,
  type WhatsAppTemplate,
} from '../entities/whatsapp-template'

/**
 * BOOK-001 W3 (AC-16): the campaign "Book now" button is a dynamic URL button
 * whose https URL ends exactly with `/b/{{1}}`; the sender fills {{1}} with
 * the recipient's own booking token. It is identified by that path, never by
 * its position, so a coupon URL button can sit beside it in one template.
 *
 * F3 (review S-1): identity is the path on any https host, not equality with
 * NEXT_PUBLIC_APP_URL. The dashboard bakes the URL into the template when it
 * is built; the campaign worker reads its own env at send time. If the two
 * drifted, an equality check read the Book now button as a coupon button and
 * filled it with the coupon code.
 */
export const BOOK_NOW_PATH = '/b/{{1}}'

/** Example suffix shown to Meta reviewers; never a real token. */
export const BOOK_NOW_EXAMPLE_TOKEN = 'sample-booking-link'

// https://<host>[/<prefix>]/b/{{1}} with nothing after it (no query, no fragment).
const BOOK_NOW_URL = /^https:\/\/[^/?#\s@]+(?:\/[^?#\s]*)?\/b\/\{\{1\}\}$/

const trimBase = (appUrl: string) => appUrl.replace(/\/+$/, '')

export function bookNowButtonUrl(appUrl: string): string {
  return `${trimBase(appUrl)}${BOOK_NOW_PATH}`
}

export function bookNowExampleUrl(appUrl: string): string {
  return `${trimBase(appUrl)}/b/${BOOK_NOW_EXAMPLE_TOKEN}`
}

/** Reserved (re-review N-2, accepted): a dynamic URL button whose path ends in /b/{{1}} on any https host is Book now. */
export function isBookNowButtonUrl(url: string | undefined): boolean {
  return typeof url === 'string' && BOOK_NOW_URL.test(url)
}

export function isBookNowButton(b: TemplateButton): boolean {
  return b.type === 'URL' && isBookNowButtonUrl(b.url)
}

/** A dynamic URL button that carries the coupon code: any one but Book now. */
export function isCouponUrlButton(b: TemplateButton): boolean {
  return isDynamicUrlButton(b) && !isBookNowButton(b)
}

export function templateHasBookNowButton(template: WhatsAppTemplate | null): boolean {
  const buttons = template?.components.find((c) => c.type === 'BUTTONS')?.buttons ?? []
  return buttons.some(isBookNowButton)
}

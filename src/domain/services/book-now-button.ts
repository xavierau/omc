import {
  isDynamicUrlButton,
  type TemplateButton,
  type WhatsAppTemplate,
} from '../entities/whatsapp-template'

/**
 * BOOK-001 W3 (AC-16): the campaign "Book now" button is a dynamic URL button
 * whose URL is exactly `${APP_URL}/b/{{1}}`; the sender fills {{1}} with the
 * recipient's own booking token. It is identified by that URL, never by its
 * position, so a coupon URL button can sit beside it in one template.
 *
 * `appUrl` is NEXT_PUBLIC_APP_URL. Callers pass it in so this stays pure; an
 * empty string matches nothing a real template carries.
 */
export const BOOK_NOW_PATH = '/b/{{1}}'

/** Example suffix shown to Meta reviewers; never a real token. */
export const BOOK_NOW_EXAMPLE_TOKEN = 'sample-booking-link'

const trimBase = (appUrl: string) => appUrl.replace(/\/+$/, '')

export function bookNowButtonUrl(appUrl: string): string {
  return `${trimBase(appUrl)}${BOOK_NOW_PATH}`
}

export function bookNowExampleUrl(appUrl: string): string {
  return `${trimBase(appUrl)}/b/${BOOK_NOW_EXAMPLE_TOKEN}`
}

export function isBookNowButton(b: TemplateButton, appUrl: string): boolean {
  return b.type === 'URL' && b.url === bookNowButtonUrl(appUrl)
}

/** A dynamic URL button that carries the coupon code: any one but Book now. */
export function isCouponUrlButton(b: TemplateButton, appUrl: string): boolean {
  return isDynamicUrlButton(b) && !isBookNowButton(b, appUrl)
}

export function templateHasBookNowButton(
  template: WhatsAppTemplate | null,
  appUrl: string
): boolean {
  const buttons = template?.components.find((c) => c.type === 'BUTTONS')?.buttons ?? []
  return buttons.some((b) => isBookNowButton(b, appUrl))
}

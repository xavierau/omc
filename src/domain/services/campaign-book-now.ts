import { isSafeHttpsUrl, type BookingMode } from '../value-objects/booking-config'

/**
 * BOOK-001 W3 (AC-16/AC-17): the rules a campaign's Book now toggle and
 * booking URL override must satisfy. One module for the API guard and the
 * campaign form, so the two cannot drift.
 */
export type BookNowIssue =
  | 'template_missing_button'
  | 'toggle_off_with_button'
  | 'no_booking_link'

export interface BookNowCheck {
  enabled: boolean
  templateHasButton: boolean
  /** The campaign's own override (already validated). */
  bookingUrl: string | null
  mode: BookingMode
  externalUrl: string | null
}

/** External mode with neither the restaurant's link nor the campaign's. */
function lacksExternalLink(c: Pick<BookNowCheck, 'mode' | 'externalUrl' | 'bookingUrl'>): boolean {
  return c.mode === 'external' && !c.externalUrl && !c.bookingUrl
}

export function bookNowIssue(c: BookNowCheck): BookNowIssue | null {
  if (c.enabled && !c.templateHasButton) return 'template_missing_button'
  if (!c.enabled && c.templateHasButton) return 'toggle_off_with_button'
  if (c.enabled && lacksExternalLink(c)) return 'no_booking_link'
  return null
}

/** API copy for each issue (the form shows its own i18n text). */
export const BOOK_NOW_ISSUE_MESSAGES: Record<BookNowIssue, string> = {
  template_missing_button:
    'Book now is on, but the selected WhatsApp template has no Book now button. Pick a template with the Book now button or turn Book now off.',
  toggle_off_with_button:
    'The selected WhatsApp template has a Book now button: turn on Book now for this campaign, or pick a template without it.',
  no_booking_link:
    'Add a booking link in settings, or set a booking URL for this campaign, before turning on Book now.',
}

export type ParsedBookingUrl = { ok: true; value: string | null } | { ok: false }

/** R14: absent/blank → null; otherwise an https URL with a host, ≤ 2,048 chars. */
export function parseCampaignBookingUrl(raw: unknown): ParsedBookingUrl {
  if (raw === undefined || raw === null) return { ok: true, value: null }
  if (typeof raw !== 'string') return { ok: false }
  const value = raw.trim()
  if (value === '') return { ok: true, value: null }
  return isSafeHttpsUrl(value) ? { ok: true, value } : { ok: false }
}

/**
 * What the campaign form shows for the toggle: hidden while booking is off
 * (unless this campaign already has it on), disabled with "Add a booking link
 * in settings" in External mode with no link anywhere, else available.
 */
export type BookNowToggleState = 'hidden' | 'no_link' | 'available'

export function bookNowToggleState(input: {
  mode: BookingMode
  externalUrl: string | null
  campaignUrl: string | null
  enabled: boolean
}): BookNowToggleState {
  if (input.mode === 'off' && !input.enabled) return 'hidden'
  const lacksLink = lacksExternalLink({ ...input, bookingUrl: input.campaignUrl })
  return lacksLink ? 'no_link' : 'available'
}

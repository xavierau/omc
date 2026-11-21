/**
 * BOOK-009 AC-10: a booking whose diner accepted the booking terms shows
 * "Terms accepted" with the accepted text in every place staff see it (day
 * panel row, desktop table, phone cards); text is rendered as text (R3).
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${ns}.${key}:${JSON.stringify(vars)}` : `${ns}.${key}`,
  useLocale: () => 'en',
}))

import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
import { BookingRow } from '../booking-row'
import { BookingsTableDesktop } from '../bookings/bookings-table-desktop'
import { BookingsTableCards } from '../bookings/bookings-table-cards'
import type { BookingItem } from '@/hooks/use-bookings'

const plain: BookingItem = {
  id: 'b1', restaurantId: 'r', memberId: null, phone: '+85290000001', name: 'Test Diner', partySize: 4, bookingDate: '2026-11-26',
  bookingTime: '20:00', notes: null, status: 'pending', declineReason: null, decidedBy: null, decidedAt: null, source: 'chat',
  campaignId: null, createdAt: '2026-11-19T00:00:00Z', decisionMessageStatus: null, termsAcceptedAt: null, termsText: null,
}
const accepted: BookingItem = {
  ...plain, id: 'b2', bookingTime: '20:30', termsAcceptedAt: '2026-11-20T02:00:00Z', termsText: '請準時<b>到達</b>\n\nArrive on time',
}
const actions = { busyIds: new Set<string>(), undelivered: new Set<string>(), onDecide: () => {} }
const groups = [{ date: '2026-11-26', bookings: [plain, accepted] }]

const views: Record<string, () => string> = {
  'day panel row': () =>
    [plain, accepted].map((b) => renderToStaticMarkup(<BookingRow booking={b} busy={false} undelivered={false} onDecide={() => {}} />)).join(''),
  'desktop table': () => renderToStaticMarkup(<BookingsTableDesktop groups={groups} today="2026-11-19" {...actions} />),
  'phone cards': () => renderToStaticMarkup(<BookingsTableCards groups={groups} today="2026-11-19" {...actions} />),
}

describe.each(Object.keys(views))('terms acceptance in the %s', (name) => {
  const html = views[name]()

  it('shows the badge with the accepted text, escaped, only on the booking that has it', () => {
    expect(html).toContain('data-testid="booking-row-b2-terms"')
    expect(html).not.toContain('data-testid="booking-row-b1-terms"')
    expect(html).toContain('bookings.termsAccepted')
    expect(html).toContain('請準時&lt;b&gt;到達&lt;/b&gt;')
    expect(html).not.toContain('<b>到達</b>')
  })
})

it('the badge label exists in both languages', () => {
  expect(en.bookings.termsAccepted).toBe('Terms accepted')
  expect(zhHK.bookings.termsAccepted).toBe('已同意訂座須知')
})

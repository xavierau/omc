import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${ns}.${key}:${JSON.stringify(vars)}` : `${ns}.${key}`,
  useLocale: () => 'en',
}))
vi.mock('next/link', () => ({ default: (p: { href: string; children: unknown }) => p.children }))

import { BookingList, BookingNoticeLine } from '../booking-list'
import { BookingSettingsSection } from '../booking-settings-section'
import { bookingsNavItem } from '../sidebar'
import { BookingsCalendar } from '../bookings/bookings-calendar'
import { BookingsTable } from '../bookings/bookings-table'
import { CalendarDayPanel } from '../bookings/calendar-day-panel'
import { DEFAULT_BOOKING_CONFIG } from '@/domain/value-objects/booking-config'
import type { BookingItem } from '@/hooks/use-bookings'

const row = (id: string, status: BookingItem['status'], extra: Partial<BookingItem> = {}): BookingItem => ({
  id, restaurantId: 'r', memberId: null, phone: '+85291234567', name: '<b>Chan</b>', partySize: 4,
  bookingDate: '2026-11-21', bookingTime: '19:30', notes: '<img src=x onerror=alert(1)>', status,
  declineReason: null, decidedBy: null, decidedAt: null, source: 'chat', campaignId: null, createdAt: '2026-11-12T00:00:00Z',
  decisionMessageStatus: null, ...extra,
})

const actions = { busyId: null, undelivered: new Set<string>(), onDecide: () => {} }
const html = (el: ReactElement) => renderToStaticMarkup(el)
const occurrences = (markup: string, needle: string) => markup.split(needle).length - 1

const calendar = (bookings: BookingItem[], isPhone = false, extra: Partial<Parameters<typeof BookingsCalendar>[0]> = {}) =>
  html(<BookingsCalendar bookings={bookings} monthEmpty={bookings.length === 0} selected="2026-11-21" today="2026-11-19" isPhone={isPhone} onSelect={() => {}} {...actions} {...extra} />)
const table = (bookings: BookingItem[], isPhone = false, extra: Partial<Parameters<typeof BookingsTable>[0]> = {}) =>
  html(<BookingsTable bookings={bookings} rangeEmpty={bookings.length === 0} range="upcoming" today="2026-11-19" isPhone={isPhone} onRange={() => {}} {...actions} {...extra} />)

/** Every place a booking row renders (BOOK-004: day list, calendar desktop/phone, table desktop/phone). */
const RENDERINGS: Array<[string, (b: BookingItem[], extra?: { undelivered: ReadonlySet<string> }) => string]> = [
  ['day list', (b, extra) => html(<BookingList bookings={b} {...actions} {...extra} />)],
  ['calendar desktop', (b, extra) => calendar(b, false, extra)],
  ['calendar phone', (b, extra) => calendar(b, true, extra)],
  ['table desktop', (b, extra) => table(b, false, extra)],
  ['table phone', (b, extra) => table(b, true, extra)],
]

describe('Bookings dashboard', () => {
  it('reachable: the sidebar Bookings entry points at /dashboard/bookings', () => {
    expect(bookingsNavItem((k) => `t:${k}`)).toMatchObject({ label: 't:bookings', href: '/dashboard/bookings' })
  })

  it('shows the empty state for an empty month and an empty table range', () => {
    const month = html(<CalendarDayPanel date="2026-11-21" bookings={[]} monthEmpty {...actions} />)
    expect(month).toContain('data-testid="booking-list-empty"')
    expect(month).toContain('bookings.views.emptyMonthTitle')
    expect(table([])).toContain('data-testid="booking-list-empty"')
    expect(table([])).toContain('bookings.views.emptyUpcomingTitle')
    expect(table([], false, { range: 'past' })).toContain('bookings.views.emptyPastTitle')
  })

  it('an empty day in a month with bookings, or a filter matching nothing, is not the empty state', () => {
    const day = html(<CalendarDayPanel date="2026-11-22" bookings={[]} monthEmpty={false} {...actions} />)
    expect(day).toContain('data-testid="bookings-day-empty"')
    expect(day).not.toContain('booking-list-empty')
    expect(table([], false, { rangeEmpty: false })).toContain('data-testid="bookings-no-match"')
  })

  it.each(RENDERINGS)('%s: Confirm/Decline on pending only, diner text escaped, one copy of each row', (_name, render) => {
    const markup = render([row('b1', 'pending'), row('b2', 'confirmed')])
    expect(markup).toContain('data-testid="booking-row-b1-confirm"')
    expect(markup).toContain('data-testid="booking-row-b1-decline"')
    expect(markup).not.toContain('booking-row-b2-confirm')
    expect(markup).toContain('data-testid="booking-row-b1-status"')
    expect(occurrences(markup, 'data-testid="booking-row-b1"')).toBe(1)
    expect(occurrences(markup, 'data-testid="booking-row-b2"')).toBe(1)
    expect(markup).toContain('&lt;b&gt;Chan&lt;/b&gt;')
    expect(markup).not.toContain('<img src=x')
    expect(markup).not.toContain('<b>Chan')
  })

  it.each(RENDERINGS)('%s AC-14 warning: a decided row whose message failed shows the not-delivered badge', (_name, render) => {
    const markup = render([row('b2', 'confirmed')], { undelivered: new Set(['b2']) })
    expect(markup).toContain('data-testid="booking-row-b2-not-delivered"')
    expect(markup).toContain('bookings.status.confirmed')
  })

  // F9: after a reload the in-memory set is empty; the stored status decides.
  it.each(RENDERINGS)('%s AC-14 warning after a reload: the stored not_delivered status shows the badge', (_name, render) => {
    expect(render([row('b3', 'declined', { decisionMessageStatus: 'not_delivered' })])).toContain('data-testid="booking-row-b3-not-delivered"')
    expect(render([row('b4', 'confirmed', { decisionMessageStatus: 'delivered' })])).not.toContain('not-delivered')
  })

  it.each(RENDERINGS)('%s BOOK-003: an AI-agent booking carries the via-agent marker once; a chat booking none', (_name, render) => {
    const markup = render([row('a1', 'pending', { source: 'agent' }), row('c1', 'pending')])
    expect(occurrences(markup, 'data-testid="booking-row-a1-via-agent"')).toBe(1)
    expect(markup).not.toContain('booking-row-c1-via-agent')
  })

  it('shows sent and already-handled notices', () => {
    expect(html(<BookingNoticeLine notice={{ kind: 'sent', decision: 'confirm' }} />)).toContain('bookings.confirmationSent')
    const handled = html(<BookingNoticeLine notice={{ kind: 'already_handled', status: 'declined' }} />)
    expect(handled).toContain('data-testid="booking-action-notice"')
    expect(handled).toContain('bookings.alreadyHandled')
    expect(handled).toContain('bookings.alreadyHandledStatus.declined')
  })

  it('calendar desktop: a Sunday-first November grid; a day shows guests without declined, 3 chips, then +N more', () => {
    const day = [
      row('d1', 'pending', { bookingTime: '12:30', partySize: 2 }),
      row('d2', 'confirmed', { bookingTime: '13:00', partySize: 4 }),
      row('d3', 'confirmed', { bookingTime: '18:30', partySize: 2 }),
      row('d4', 'declined', { bookingTime: '20:30', partySize: 6 }),
    ]
    const markup = calendar(day)
    expect(markup).toContain('data-testid="bookings-calendar"')
    expect(markup.indexOf('bookings-calendar-day-2026-11-01')).toBeLessThan(markup.indexOf('bookings-calendar-day-2026-11-02'))
    expect(occurrences(markup, 'data-testid="bookings-calendar-day-')).toBe(35)
    expect(markup).toContain('data-testid="bookings-calendar-day-2026-12-05"')
    expect(markup).toContain('bookings.views.guests:{&quot;count&quot;:8}')
    expect(markup).toContain('bookings.views.more:{&quot;count&quot;:1}')
    expect(markup).toContain('data-testid="bookings-day-panel"')
    expect(markup).toContain('bookings.views.needReply:{&quot;count&quot;:1}')
  })

  it('calendar phone: the week strip of the selected day, no month grid', () => {
    const markup = calendar([row('b1', 'pending')], true)
    expect(occurrences(markup, 'data-testid="bookings-calendar-day-')).toBe(7)
    expect(markup).toContain('data-testid="bookings-calendar-day-2026-11-15"')
    expect(markup).toContain('data-testid="bookings-calendar-day-2026-11-21"')
  })

  it('table: day groups soonest first with Today labelled; past is newest first', () => {
    const list = [row('later', 'pending', { bookingDate: '2026-11-24' }), row('today', 'confirmed', { bookingDate: '2026-11-19' })]
    const markup = table(list)
    expect(markup).toContain('data-testid="bookings-table"')
    expect(markup.indexOf('booking-row-today')).toBeLessThan(markup.indexOf('booking-row-later'))
    expect(markup).toContain('bookings.views.todayLabel')
    const past = table(list, false, { range: 'past' })
    expect(past.indexOf('booking-row-later')).toBeLessThan(past.indexOf('booking-row-today'))
    expect(past).toContain('bookings.views.showUpcoming')
  })

  it('settings: external mode with no URL shows the add-link hint and disables Save', () => {
    const markup = renderToStaticMarkup(<BookingSettingsSection initialConfig={{ ...DEFAULT_BOOKING_CONFIG, mode: 'external' }} />)
    expect(markup).toContain('data-testid="booking-settings-url-warning"')
    expect(markup).toMatch(/data-testid="booking-settings-save"[^>]*disabled|disabled[^>]*data-testid="booking-settings-save"/)
  })

  it('settings: simple mode shows lifetimes with No expiry and the max party size', () => {
    const markup = renderToStaticMarkup(
      <BookingSettingsSection initialConfig={{ ...DEFAULT_BOOKING_CONFIG, mode: 'simple', chatLinkTtlHours: null }} />
    )
    expect(markup).toContain('data-testid="booking-settings-chat-no-expiry"')
    expect(markup).toContain('data-testid="booking-settings-max-party"')
  })
})

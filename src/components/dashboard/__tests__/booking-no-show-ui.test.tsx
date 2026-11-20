/**
 * BOOK-007 AC-3: "Mark no-show" only on a past confirmed booking, in every
 * place a booking row renders (desktop table, phone cards, calendar day
 * panel); a no_show booking shows its badge (muted) and Undo; the no_show
 * filter chip; the action calls wire to POST / DELETE .../no-show.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${ns}.${key}:${JSON.stringify(vars)}` : `${ns}.${key}`,
  useLocale: () => 'en',
}))

import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
import { BookingRow, STATUS_TONE } from '../booking-row'
import { CalendarDayPanel } from '../bookings/calendar-day-panel'
import { BookingsTableDesktop } from '../bookings/bookings-table-desktop'
import { BookingsTableCards } from '../bookings/bookings-table-cards'
import { BookingsFilters } from '../bookings/bookings-filters'
import { noShowOutcome, requestNoShow } from '../bookings/use-booking-no-show'
import type { BookingItem } from '@/hooks/use-bookings'

// 2026-11-20 03:00 UTC = 11:00 in Hong Kong.
const NOW = new Date('2026-11-20T03:00:00Z')

const b = (id: string, status: BookingItem['status'], date: string, time = '19:30'): BookingItem => ({
  id, restaurantId: 'r', memberId: null, phone: '+85290000001', name: 'Test Diner', partySize: 2, bookingDate: date,
  bookingTime: time, notes: null, status, declineReason: null, decidedBy: null, decidedAt: null, source: 'chat',
  campaignId: null, createdAt: '2026-11-01T00:00:00Z', decisionMessageStatus: null,
})

const pastConfirmed = b('pc', 'confirmed', '2026-11-19')
const earlierToday = b('et', 'confirmed', '2026-11-20', '10:30')
const laterToday = b('lt', 'confirmed', '2026-11-20', '11:00')
const futureConfirmed = b('fc', 'confirmed', '2026-11-21')
const pastPending = b('pp', 'pending', '2026-11-19')
const pastDeclined = b('pd', 'declined', '2026-11-19')
const pastCancelled = b('px', 'cancelled', '2026-11-19')
const noShow = b('ns', 'no_show', '2026-11-19')
const all = [pastConfirmed, earlierToday, laterToday, futureConfirmed, pastPending, pastDeclined, pastCancelled, noShow]

const actions = { busyId: null, undelivered: new Set<string>(), onDecide: () => {}, onNoShow: () => {} }
const groups = [{ date: '2026-11-19', bookings: all }]

const views: Record<string, () => string> = {
  'desktop table': () => renderToStaticMarkup(<BookingsTableDesktop groups={groups} today="2026-11-20" {...actions} />),
  'phone cards': () => renderToStaticMarkup(<BookingsTableCards groups={groups} today="2026-11-20" {...actions} />),
  'calendar day panel': () =>
    renderToStaticMarkup(<CalendarDayPanel date="2026-11-19" bookings={all} monthEmpty={false} {...actions} />),
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

describe.each(Object.keys(views))('BOOK-007 no-show in the %s', (name) => {
  it('offers Mark no-show on past confirmed bookings only (earlier today included)', () => {
    const html = views[name]()
    expect(html).toContain('data-testid="booking-row-pc-no-show"')
    expect(html).toContain('data-testid="booking-row-et-no-show"')
    for (const id of ['lt', 'fc', 'pp', 'pd', 'px', 'ns']) expect(html).not.toContain(`data-testid="booking-row-${id}-no-show"`)
    expect(html).toContain('bookings.markNoShow')
  })

  it('a no_show booking shows its badge and Undo, and no Confirm/Decline', () => {
    const html = views[name]()
    expect(html).toContain('bookings.status.no_show')
    expect(html).toContain('data-testid="booking-row-ns-no-show-undo"')
    expect(html).toContain('bookings.undoNoShow')
    expect(html).not.toContain('data-testid="booking-row-ns-confirm"')
    for (const id of ['pc', 'et', 'lt', 'fc', 'pp', 'pd', 'px']) expect(html).not.toContain(`booking-row-${id}-no-show-undo`)
  })
})

describe('BOOK-007 no-show badge, chip and copy', () => {
  it('the no_show badge is muted like declined', () => {
    expect(STATUS_TONE.no_show).toBe(STATUS_TONE.declined)
    const html = renderToStaticMarkup(<BookingRow booking={noShow} busy={false} undelivered={false} onDecide={() => {}} onNoShow={() => {}} />)
    expect(html).toContain(`data-testid="booking-row-ns-status"`)
  })

  it('without an onNoShow handler no no-show action renders', () => {
    const html = renderToStaticMarkup(<BookingRow booking={pastConfirmed} busy={false} undelivered={false} onDecide={() => {}} />)
    expect(html).not.toContain('booking-row-pc-no-show')
  })

  it('the filter row has a no_show chip with its count', () => {
    const counts = { all: 3, pending: 0, confirmed: 1, declined: 0, cancelled: 0, no_show: 2 }
    const html = renderToStaticMarkup(
      <BookingsFilters status="no_show" counts={counts} query="" showSearch onStatus={() => {}} onQuery={() => {}} />
    )
    expect(html).toMatch(/data-testid="bookings-filter-no-show"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*data-testid="bookings-filter-no-show"/)
    expect(html).toContain('bookings.views.filter.no_show')
  })

  it('every new string exists in en and zh-HK', () => {
    for (const m of [en, zhHK]) {
      expect(m.bookings.status.no_show).toBeTruthy()
      expect(m.bookings.alreadyHandledStatus.no_show).toBeTruthy()
      expect(m.bookings.views.filter.no_show).toBeTruthy()
      expect(m.bookings.markNoShow).toBeTruthy()
      expect(m.bookings.undoNoShow).toBeTruthy()
    }
    expect(zhHK.bookings.markNoShow).toBe('標記未出席')
    expect(zhHK.bookings.status.no_show).toBe('未出席')
  })
})

describe('BOOK-007 no-show calls', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('mark POSTs and undo DELETEs .../no-show for that booking', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ booking: noShow }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await requestNoShow('ns', 'mark')).toEqual({ kind: 'done' })
    expect(await requestNoShow('ns', 'undo')).toEqual({ kind: 'done' })
    expect(fetchMock.mock.calls.map((c) => [c[0], (c[1] as RequestInit).method])).toEqual([
      ['/api/dashboard/bookings/ns/no-show', 'POST'],
      ['/api/dashboard/bookings/ns/no-show', 'DELETE'],
    ])
  })

  it('maps the API answers: 409 → already handled with its status, 404 → gone, other → error', () => {
    expect(noShowOutcome(409, { error: 'already_handled', status: 'pending' })).toEqual({ kind: 'already_handled', status: 'pending' })
    expect(noShowOutcome(404, { error: 'not_found' })).toEqual({ kind: 'not_found' })
    expect(noShowOutcome(500, null)).toEqual({ kind: 'error' })
  })
})

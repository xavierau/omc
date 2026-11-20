/**
 * BOOK-004 r4: the AGENT-003 booking-row behaviours (7af9494b) in every place
 * the new views render a booking: the cancelled-by badge, the change-from
 * line, and a cancelled booking greyed + struck through (owner 2026-11-19).
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const usedKeys = new Set<string>()
vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) => {
    usedKeys.add(`${ns}.${key}`)
    return vars ? `${ns}.${key}:${JSON.stringify(vars)}` : `${ns}.${key}`
  },
  useLocale: () => 'en',
}))

import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
import { BookingRow } from '../booking-row'
import { BookingsTableDesktop } from '../bookings/bookings-table-desktop'
import { BookingsTableCards } from '../bookings/bookings-table-cards'
import { CalendarMonthGrid } from '../bookings/calendar-month-grid'
import { BookingsFilters } from '../bookings/bookings-filters'
import type { BookingItem } from '@/hooks/use-bookings'

const base: BookingItem = {
  id: 'b-new', restaurantId: 'r', memberId: null, phone: '+85290000001', name: 'Test Diner', partySize: 4, bookingDate: '2026-11-26',
  bookingTime: '20:00', notes: null, status: 'pending', declineReason: null, decidedBy: null, decidedAt: null, source: 'agent',
  campaignId: null, createdAt: '2026-11-19T00:00:00Z', decisionMessageStatus: null,
}
const change: BookingItem = { ...base, replacesBookingId: 'b-old', replaces: { bookingDate: '2026-11-25', bookingTime: '19:30', partySize: 4 } }
const byDiner: BookingItem = { ...base, id: 'b-c', bookingTime: '18:00', status: 'cancelled', cancelledBy: 'diner_ai', source: 'chat' }
const replaced: BookingItem = { ...base, id: 'b-old', bookingTime: '19:00', status: 'cancelled', cancelledBy: 'change' }
const day = [byDiner, replaced, change]
const actions = { busyId: null, undelivered: new Set<string>(), onDecide: () => {} }
const groups = [{ date: '2026-11-26', bookings: day }]

const views: Record<string, () => string> = {
  'day panel row': () => day.map((b) => renderToStaticMarkup(<BookingRow booking={b} busy={false} undelivered={false} onDecide={() => {}} />)).join(''),
  'desktop table': () => renderToStaticMarkup(<BookingsTableDesktop groups={groups} today="2026-11-19" {...actions} />),
  'phone cards': () => renderToStaticMarkup(<BookingsTableCards groups={groups} today="2026-11-19" {...actions} />),
}

/** One booking's rendered markup: from its row element's opening tag to the next row (or the end). */
const rowOf = (html: string, id: string) => {
  const own = html.indexOf(`data-testid="booking-row-${id}"`)
  const start = html.lastIndexOf('<', own)
  const next = html.slice(own + 1).search(/data-testid="booking-row-[^"-]+(-[a-z]+)?"/)
  return next < 0 ? html.slice(start) : html.slice(start, html.lastIndexOf('<', own + 1 + next))
}
/** The opening tag of a calendar chip, found by its title (time + name). */
const chipTag = (html: string, title: string) => {
  const at = html.indexOf(`title="${title}"`)
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at))
}

describe.each(Object.keys(views))('AGENT-003 rows in the %s', (name) => {
  const html = views[name]()

  it('shows who cancelled: the diner through the AI agent, or a confirmed change', () => {
    expect(html).toContain('data-testid="booking-row-b-c-cancelled-by-diner"')
    expect(html).toContain('data-testid="booking-row-b-old-cancelled-by-change"')
    expect(html).toContain('bookings.status.cancelled')
  })

  it('shows a change request old → new and keeps its Confirm / Decline', () => {
    expect(html).toContain('data-testid="booking-row-b-new-change-from"')
    expect(html).toContain('2026-11-25 19:30')
    expect(html).toContain('data-testid="booking-row-b-new-confirm"')
  })

  it('a cancelled booking is greyed and struck through, with no actions', () => {
    expect(rowOf(html, 'b-c')).toContain('line-through')
    expect(rowOf(html, 'b-c')).toContain('text-muted-foreground')
    expect(rowOf(html, 'b-old')).toContain('line-through')
    expect(rowOf(html, 'b-new')).not.toContain('line-through')
    expect(html).not.toContain('booking-row-b-c-confirm')
  })
})

describe('AGENT-003 cancelled bookings in the calendar', () => {
  it('month grid: a cancelled chip is struck through and its guests are left out', () => {
    const html = renderToStaticMarkup(
      <CalendarMonthGrid bookings={[byDiner, { ...base, id: 'ok', status: 'confirmed', partySize: 3 }]} selected="2026-11-26" today="2026-11-19" onSelect={() => {}} />
    )
    expect(chipTag(html, '18:00 Test Diner')).toContain('line-through')
    expect(chipTag(html, '20:00 Test Diner')).not.toContain('line-through')
    expect(html).toContain('bookings.views.guests:{&quot;count&quot;:3}')
  })

  it('filters: Cancelled has its own chip with its count', () => {
    const counts = { all: 3, pending: 1, confirmed: 0, declined: 0, cancelled: 2 }
    const html = renderToStaticMarkup(
      <BookingsFilters status="all" counts={counts} query="" showSearch onStatus={() => {}} onQuery={() => {}} />
    )
    expect(html).toContain('data-testid="bookings-filter-cancelled"')
    expect(html).toContain('bookings.views.filter.cancelled')
  })

  it('every key these views use exists in en and zh-HK', () => {
    usedKeys.clear()
    for (const render of Object.values(views)) render()
    renderToStaticMarkup(<BookingsFilters status="all" counts={{ all: 0, pending: 0, confirmed: 0, declined: 0, cancelled: 0 }} query="" showSearch onStatus={() => {}} onQuery={() => {}} />)
    const lookup = (m: unknown, p: string) => p.split('.').reduce<unknown>((n, k) => (n && typeof n === 'object' ? (n as Record<string, unknown>)[k] : undefined), m)
    const missing = [...usedKeys].filter((k) => typeof lookup(en, k) !== 'string' || typeof lookup(zhHK, k) !== 'string')
    expect(missing).toEqual([])
  })
})

/**
 * BOOK-006: a booking with an open (pending) change request is decided only
 * through its change row. The original shows "change requested → new slot"
 * and no Confirm / Decline in every view; the change row keeps both.
 */
const original: BookingItem = {
  ...base, id: 'b-orig', bookingTime: '19:30', partySize: 2, source: 'chat',
  openChange: { id: 'b-chg', bookingDate: '2026-11-26', bookingTime: '18:30', partySize: 4 },
}
const changeRow: BookingItem = {
  ...base, id: 'b-chg', bookingTime: '18:30', replacesBookingId: 'b-orig', replaces: { bookingDate: '2026-11-26', bookingTime: '19:30', partySize: 2 },
}
/** The change moved the date: its row is outside the listed range, the original still carries it. */
const movedAway: BookingItem = { ...original, id: 'b-away', openChange: { id: 'b-far', bookingDate: '2026-12-24', bookingTime: '20:00', partySize: 6 } }
const confirmedOriginal: BookingItem = { ...original, id: 'b-conf', status: 'confirmed' }
const afterDecline: BookingItem = { ...original, id: 'b-back', openChange: null }
const pairDay = [original, changeRow, movedAway, confirmedOriginal, afterDecline]
const pairGroups = [{ date: '2026-11-26', bookings: pairDay }]
const pairViews: Record<string, () => string> = {
  'day panel row': () => pairDay.map((b) => renderToStaticMarkup(<BookingRow booking={b} busy={false} undelivered={false} onDecide={() => {}} />)).join(''),
  'desktop table': () => renderToStaticMarkup(<BookingsTableDesktop groups={pairGroups} today="2026-11-19" {...actions} />),
  'phone cards': () => renderToStaticMarkup(<BookingsTableCards groups={pairGroups} today="2026-11-19" {...actions} />),
}

describe.each(Object.keys(pairViews))('BOOK-006 change-request pairs in the %s', (name) => {
  const html = pairViews[name]()

  it('the original shows the change-requested marker with the new slot and no Confirm / Decline', () => {
    const row = rowOf(html, 'b-orig')
    expect(row).toContain('data-testid="booking-row-b-orig-change-pending"')
    expect(row).toContain('bookings.changePending:')
    expect(row).toContain('2026-11-26 18:30')
    expect(row).toContain('bookings.partyOf:{&quot;count&quot;:4}')
    expect(html).not.toContain('booking-row-b-orig-confirm')
    expect(html).not.toContain('booking-row-b-orig-decline')
  })

  it('the change row keeps its Confirm / Decline and its old → new line', () => {
    expect(html).toContain('data-testid="booking-row-b-chg-confirm"')
    expect(html).toContain('data-testid="booking-row-b-chg-decline"')
    expect(html).toContain('data-testid="booking-row-b-chg-change-from"')
    expect(html).not.toContain('booking-row-b-chg-change-pending')
  })

  it('an original whose change is dated outside the listed range still shows the marker', () => {
    expect(rowOf(html, 'b-away')).toContain('data-testid="booking-row-b-away-change-pending"')
    expect(rowOf(html, 'b-away')).toContain('2026-12-24 20:00')
    expect(html).not.toContain('booking-row-b-away-confirm')
  })

  it('a confirmed original with an open change shows the marker too', () => {
    expect(rowOf(html, 'b-conf')).toContain('data-testid="booking-row-b-conf-change-pending"')
    expect(html).not.toContain('booking-row-b-conf-confirm')
  })

  it('after the change is declined (no open change) the original has its own buttons again', () => {
    expect(html).toContain('data-testid="booking-row-b-back-confirm"')
    expect(html).toContain('data-testid="booking-row-b-back-decline"')
    expect(html).not.toContain('booking-row-b-back-change-pending')
  })
})

describe('BOOK-006 copy', () => {
  it('every key the pair views use exists in en and zh-HK', () => {
    usedKeys.clear()
    for (const render of Object.values(pairViews)) render()
    const lookup = (m: unknown, p: string) => p.split('.').reduce<unknown>((n, k) => (n && typeof n === 'object' ? (n as Record<string, unknown>)[k] : undefined), m)
    const missing = [...usedKeys].filter((k) => typeof lookup(en, k) !== 'string' || typeof lookup(zhHK, k) !== 'string')
    expect(missing).toEqual([])
  })
})

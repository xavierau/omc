/**
 * BOOK-004 r3: the Bookings page wiring, rendered with the page state and the
 * data hook stubbed (no DOM in this repo's vitest): which bookings reach the
 * view on phone Calendar (review F3), and what the month counts and the day
 * panel say when a filter or the grid's spill-over days are involved (F5).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${ns}.${key}:${JSON.stringify(vars)}` : `${ns}.${key}`,
  useLocale: () => 'en',
}))

const state = vi.hoisted(() => ({ page: {} as Record<string, unknown>, bookings: [] as unknown[] }))

vi.mock('../bookings/use-bookings-page', () => ({ useBookingsPage: () => state.page }))
vi.mock('@/hooks/use-bookings', () => ({
  useBookings: () => ({
    data: { bookings: state.bookings, pendingCount: 1, truncated: false },
    pendingCount: 1, isLoading: false, error: null, refetch: async () => {},
  }),
  useBookingActions: () => ({ busyId: null, notice: null, undelivered: new Set<string>(), act: async () => {} }),
}))

import { BookingsScreen } from '../bookings/bookings-screen'
import type { BookingItem } from '@/hooks/use-bookings'

const row = (id: string, date: string, status: BookingItem['status']): BookingItem => ({
  id, restaurantId: 'r', memberId: null, phone: '+85291234567', name: `Diner ${id}`, partySize: 2,
  bookingDate: date, bookingTime: '19:30', notes: null, status, declineReason: null, decidedBy: null, decidedAt: null,
  source: 'chat', campaignId: null, createdAt: '2026-11-12T00:00:00Z', decisionMessageStatus: null,
})

const page = (over: Record<string, unknown>) => ({
  view: 'calendar', isPhone: false, today: '2026-11-19', selected: '2026-11-21', tableRange: 'upcoming',
  status: 'all', query: '', range: { from: '2026-11-01', to: '2026-12-05' },
  setView: () => {}, setStatus: () => {}, setQuery: () => {}, setTableRange: () => {}, select: () => {},
  shift: () => {}, goToday: () => {}, showPending: () => {}, ...over,
})

const render = () => renderToStaticMarkup(<BookingsScreen />)
const chipCount = (markup: string, status: string) =>
  markup.match(new RegExp(`data-testid="bookings-filter-${status}"[^>]*>.*?<span[^>]*>(\\d+)</span>`))?.[1]

beforeEach(() => {
  state.bookings = [row('pend', '2026-11-21', 'pending'), row('conf', '2026-11-21', 'confirmed'), row('spill', '2026-12-02', 'pending')]
})

describe('BookingsScreen (BOOK-004 r3)', () => {
  // F3: Show leaves status=pending; back on phone Calendar the chips are hidden, so the day must list everything.
  it('F3: phone Calendar lists every booking of the selected day even with a hidden Pending filter and search on', () => {
    state.page = page({ isPhone: true, status: 'pending', query: 'zzz' })
    const markup = render()
    expect(markup).not.toContain('bookings-filter-pending')
    expect(markup).toContain('data-testid="booking-row-pend"')
    expect(markup).toContain('data-testid="booking-row-conf"')
    expect(markup).not.toContain('bookings-day-empty')
  })

  it('desktop Calendar still applies the filter it shows', () => {
    state.page = page({ status: 'pending' })
    const markup = render()
    expect(markup).toContain('data-testid="booking-row-pend"')
    expect(markup).not.toContain('data-testid="booking-row-conf"')
  })

  // F5: counts came from the whole grid range, spill-over days of December included.
  it("F5: the desktop Calendar chips count the selected month only, not the grid's spill-over days", () => {
    state.page = page({})
    const markup = render()
    expect(chipCount(markup, 'pending')).toBe('1')
    expect(chipCount(markup, 'confirmed')).toBe('1')
  })

  it('F5: a month whose only bookings are spill-over days shows the empty-month state', () => {
    state.bookings = [row('spill', '2026-12-02', 'pending')]
    state.page = page({})
    expect(render()).toContain('data-testid="booking-list-empty"')
  })

  // F5: a day emptied by the filter said "No bookings on this day".
  it('F5: a day emptied by the filter shows the no-match copy, not "no bookings on this day"', () => {
    state.page = page({ status: 'declined' })
    const markup = render()
    expect(markup).toContain('data-testid="bookings-no-match"')
    expect(markup).toContain('bookings.views.noMatch')
    expect(markup).not.toContain('bookings-day-empty')
  })
})

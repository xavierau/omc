/**
 * BOOK-004: which view and which dates the Bookings page shows. Pure, so the
 * owner rules are testable: Calendar by default, `?view=` wins over the last
 * choice remembered in localStorage; Table Upcoming = today onward, soonest
 * first; Past = the 90 days before today, newest first; Needs a reply (r2) =
 * every pending booking of any date, soonest first.
 */
import type { BookingDateRange } from '@/domain/entities/booking-request'
import type { BookingsQuery } from '@/hooks/use-bookings'
import { addDays, gridRange, monthKey, shiftMonth } from './booking-dates'
import type { DayOrder } from './booking-groups'

export const BOOKINGS_VIEWS = ['calendar', 'table'] as const
export type BookingsView = (typeof BOOKINGS_VIEWS)[number]
export type TableRange = 'upcoming' | 'past' | 'pending'

export const VIEW_STORAGE_KEY = 'omc.bookings.view'
export const PAST_DAYS = 90
/** How far ahead Upcoming reaches (inside the API's 400-day limit). */
export const UPCOMING_DAYS = 365

const asView = (value: string | null | undefined): BookingsView | null =>
  BOOKINGS_VIEWS.includes(value as BookingsView) ? (value as BookingsView) : null

export function resolveView(param: string | null, stored: string | null): BookingsView {
  return asView(param) ?? asView(stored) ?? 'calendar'
}

export function tableRangeDates(range: Exclude<TableRange, 'pending'>, today: string): BookingDateRange {
  return range === 'upcoming'
    ? { from: today, to: addDays(today, UPCOMING_DAYS) }
    : { from: addDays(today, -PAST_DAYS), to: addDays(today, -1) }
}

export const tableOrder = (range: TableRange): DayOrder => (range === 'past' ? 'desc' : 'asc')

/** What the needs-reply pill's Show opens: every pending booking, with the Pending filter on (owner 2026-11-19). */
export const SHOW_PENDING = { view: 'table', tableRange: 'pending', status: 'pending' } as const

/** What to fetch: the visible month grid of the selected day, the table range, or every pending booking. */
export function fetchRange(view: BookingsView, selected: string, range: TableRange, today: string): BookingsQuery {
  if (view === 'calendar') return gridRange(selected)
  return range === 'pending' ? { status: 'pending' } : tableRangeDates(range, today)
}

/** Desktop prev/next: the next month's 1st, or today when that month holds today. Phone: a week. */
export function stepSelected(selected: string, direction: 1 | -1, byWeek: boolean, today: string): string {
  if (byWeek) return addDays(selected, 7 * direction)
  const first = shiftMonth(selected, direction)
  return monthKey(first) === monthKey(today) ? today : first
}

/** localStorage may throw (private mode, blocked storage): a failed read is "no choice yet". */
export function readStoredView(): string | null {
  try {
    return window.localStorage.getItem(VIEW_STORAGE_KEY)
  } catch {
    return null
  }
}

export function storeView(view: BookingsView): void {
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, view)
  } catch {
    // Remembering the view is a convenience; the URL still carries it.
  }
}

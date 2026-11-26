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
import {
  DEFAULT_TODAY_SORT,
  defaultTodaySortDir,
  TODAY_SORT_KEYS,
  type TodaySort,
  type TodaySortDir,
  type TodaySortKey,
} from '@/domain/services/booking-today-sort'

/** BOOK-013: Today joins (first; the default on a phone). */
export const BOOKINGS_VIEWS = ['today', 'calendar', 'table'] as const
export type BookingsView = (typeof BOOKINGS_VIEWS)[number]
export type TableRange = 'upcoming' | 'past' | 'pending'

export const VIEW_STORAGE_KEY = 'omc.bookings.view'
export const PAST_DAYS = 90
/** How far ahead Upcoming reaches (inside the API's 400-day limit). */
export const UPCOMING_DAYS = 365

const asView = (value: string | null | undefined): BookingsView | null =>
  BOOKINGS_VIEWS.includes(value as BookingsView) ? (value as BookingsView) : null

/** `?view=` > the remembered choice > Today on a phone (BOOK-013 S7) / Calendar on desktop. */
export function resolveView(param: string | null, stored: string | null, isPhone = false): BookingsView {
  return asView(param) ?? asView(stored) ?? (isPhone ? 'today' : 'calendar')
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
  // BOOK-013: Today reads its own list (/today); the pending count still comes from this one.
  if (view === 'today') return { from: today, to: today }
  if (view === 'calendar') return gridRange(selected)
  return range === 'pending' ? { status: 'pending' } : tableRangeDates(range, today)
}

const asSortKey = (value: string | null): TodaySortKey | null =>
  TODAY_SORT_KEYS.includes(value as TodaySortKey) ? (value as TodaySortKey) : null

/**
 * BOOK-013 AC-25: `?sort=` and `?dir=` of the Today view. A key without a
 * direction starts at that key's default; any invalid value is time, earliest first.
 */
export function resolveTodaySort(sort: string | null, dir: string | null): TodaySort {
  const key = asSortKey(sort)
  if (!key) return DEFAULT_TODAY_SORT
  if (dir === null) return { key, dir: defaultTodaySortDir(key) }
  return dir === 'asc' || dir === 'desc' ? { key, dir: dir as TodaySortDir } : DEFAULT_TODAY_SORT
}

/** The Today view's query string with its sort, so a reload keeps it. */
export const todaySortSearch = (sort: TodaySort): string => `view=today&sort=${sort.key}&dir=${sort.dir}`

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

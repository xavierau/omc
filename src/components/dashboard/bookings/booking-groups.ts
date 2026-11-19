/**
 * BOOK-004: pure list logic shared by the calendar and table views: status
 * filter + name/phone search (client-side, R6: never in the URL), per-day
 * groups, and covers (guests; declined bookings do not come).
 */
import type { BookingItem } from '@/hooks/use-bookings'
import { monthKey } from './booking-dates'

export const STATUS_FILTERS = ['all', 'pending', 'confirmed', 'declined'] as const
export type StatusFilter = (typeof STATUS_FILTERS)[number]
export type DayOrder = 'asc' | 'desc'

export interface DayGroup {
  date: string
  bookings: BookingItem[]
}

export interface DaySummary {
  count: number
  guests: number
  pending: number
}

const digits = (value: string) => value.replace(/\D/g, '')
/** A query made only of digits and phone punctuation is a phone search. */
const PHONE_QUERY = /^[\d\s+()-]+$/

/**
 * Name: case-insensitive substring. Phone: the query's digits inside the
 * phone's digits, only when the query is digits/phone punctuation alone, so a
 * mixed query like "Chan 9" never matches every phone with a 9 (review F6).
 */
export function matchesSearch(booking: BookingItem, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q === '') return true
  if ((booking.name ?? '').toLowerCase().includes(q)) return true
  const qDigits = digits(q)
  return PHONE_QUERY.test(q) && qDigits !== '' && digits(booking.phone).includes(qDigits)
}

export function filterBookings(bookings: BookingItem[], status: StatusFilter, query: string): BookingItem[] {
  return bookings.filter((b) => (status === 'all' || b.status === status) && matchesSearch(b, query))
}

export function statusCounts(bookings: BookingItem[]): Record<StatusFilter, number> {
  const counts = { all: bookings.length, pending: 0, confirmed: 0, declined: 0 }
  for (const b of bookings) if (b.status !== 'unverified') counts[b.status] += 1
  return counts
}

export function covers(bookings: BookingItem[]): number {
  return bookings.reduce((sum, b) => (b.status === 'declined' ? sum : sum + b.partySize), 0)
}

export function daySummary(bookings: BookingItem[]): DaySummary {
  return { count: bookings.length, guests: covers(bookings), pending: bookings.filter((b) => b.status === 'pending').length }
}

const byDateTime = (a: BookingItem, b: BookingItem) =>
  a.bookingDate.localeCompare(b.bookingDate) || a.bookingTime.localeCompare(b.bookingTime)

/** Days in `order`, and within a day times in the same order (upcoming soonest first, past newest first). */
export function groupByDay(bookings: BookingItem[], order: DayOrder): DayGroup[] {
  const sorted = [...bookings].sort((a, b) => (order === 'asc' ? byDateTime(a, b) : byDateTime(b, a)))
  const groups: DayGroup[] = []
  for (const booking of sorted) {
    const last = groups[groups.length - 1]
    if (last && last.date === booking.bookingDate) last.bookings.push(booking)
    else groups.push({ date: booking.bookingDate, bookings: [booking] })
  }
  return groups
}

/** One day's bookings by time, from any list. */
export function bookingsOn(bookings: BookingItem[], date: string): BookingItem[] {
  return bookings.filter((b) => b.bookingDate === date).sort(byDateTime)
}

export interface PageListsInput {
  calendar: boolean
  isPhone: boolean
  selected: string
  status: StatusFilter
  query: string
}

export interface PageLists {
  /** Phone Calendar hides the chips and search, so it applies neither (review F3). */
  filtersShown: boolean
  shown: BookingItem[]
  /** Chip counts: the selected month in Calendar (no spill-over days, F5), the whole range in Table. */
  counts: Record<StatusFilter, number>
  /** No bookings in that month / range at all: the page's empty state. */
  scopeEmpty: boolean
  /** The selected day has bookings but the filter hid them all: "no match", not "no bookings" (F5). */
  dayHidden: boolean
}

/** What the Bookings page lists, counts and calls empty, from every booking it loaded. */
export function bookingsPageLists(all: BookingItem[], o: PageListsInput): PageLists {
  const filtersShown = !(o.calendar && o.isPhone)
  const shown = filtersShown ? filterBookings(all, o.status, o.query) : all
  const scope = o.calendar ? all.filter((b) => monthKey(b.bookingDate) === monthKey(o.selected)) : all
  const dayHidden = bookingsOn(all, o.selected).length > 0 && bookingsOn(shown, o.selected).length === 0
  return { filtersShown, shown, counts: statusCounts(scope), scopeEmpty: scope.length === 0, dayHidden }
}

/** The calendar chip label: the first word of the name. */
export function chipName(name: string | null): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? ''
}

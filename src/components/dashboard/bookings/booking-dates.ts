/**
 * BOOK-004: calendar arithmetic on plain YYYY-MM-DD strings (booking_date has
 * no time zone). Weeks start Sunday (owner 2026-11-19); "today" is Hong Kong's.
 */
import type { BookingDateRange } from '@/domain/entities/booking-request'

const DAY_MS = 86_400_000

const toMs = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export function todayInHongKong(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export function addDays(date: string, days: number): string {
  return fromMs(toMs(date) + days * DAY_MS)
}

/** 0 = Sunday. */
export function weekday(date: string): number {
  return new Date(toMs(date)).getUTCDay()
}

export const monthKey = (date: string) => date.slice(0, 7)

/** The first day of the month `months` away from `date`'s month. */
export function shiftMonth(date: string, months: number): string {
  const d = new Date(toMs(date))
  return fromMs(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1))
}

/** Sunday..Saturday of the week holding `date`. */
export function weekOf(date: string): string[] {
  const sunday = addDays(date, -weekday(date))
  return Array.from({ length: 7 }, (_, i) => addDays(sunday, i))
}

/** The month of `date` as whole Sunday-first weeks (5 or 6 rows; 4 only for a Sunday-1st February). */
export function monthGrid(date: string): string[][] {
  const key = monthKey(date)
  const weeks: string[][] = []
  for (let week = weekOf(shiftMonth(date, 0)); week.some((d) => monthKey(d) === key); week = weekOf(addDays(week[0], 7))) {
    weeks.push(week)
  }
  return weeks
}

/** The dates the month grid of `date` shows, first Sunday to last Saturday. */
export function gridRange(date: string): BookingDateRange {
  const weeks = monthGrid(date)
  return { from: weeks[0][0], to: weeks[weeks.length - 1][6] }
}

/** Calendar date formatting in UTC so a YYYY-MM-DD never shifts a day. */
export function formatDate(date: string, locale: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(new Date(toMs(date)))
}

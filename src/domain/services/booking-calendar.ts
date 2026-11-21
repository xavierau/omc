/**
 * BOOK-009: calendar arithmetic on Hong Kong wall-clock dates and times.
 * Dates are `YYYY-MM-DD`, times `HH:MM`; HK has no daylight saving, so a day
 * is always 24 hours and plain UTC date maths on the strings is exact.
 */
import type { Weekday } from '@/domain/value-objects/booking-hours'

const DAY_MS = 86_400_000
const BY_UTC_DAY: readonly Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

/** Days since 1970-01-01 for a valid `YYYY-MM-DD`. */
export function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / DAY_MS
}

export function addDays(date: string, days: number): string {
  return new Date((dayNumber(date) + days) * DAY_MS).toISOString().slice(0, 10)
}

export function weekdayOf(date: string): Weekday {
  return BY_UTC_DAY[new Date(dayNumber(date) * DAY_MS).getUTCDay()]
}

export function toMinutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
}

export function fromMinutes(minutes: number): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
}

/** Minutes since the epoch for a wall-clock date and time (comparisons across midnight). */
export function absoluteMinutes(date: string, time: string): number {
  return dayNumber(date) * 1440 + toMinutes(time)
}

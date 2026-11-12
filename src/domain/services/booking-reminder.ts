/**
 * BOOK-001 W3 (AC-15, R19): when a booking reminder is due and when a
 * booking's personal data is purged. Booking dates and times are restaurant
 * local time, Asia/Hong_Kong (UTC+8, no daylight saving).
 */
import { hongKongToday } from './booking-submission'

export const REMINDER_LEAD_HOURS = 3
export const RETENTION_DAYS = 180

const HOUR_MS = 3_600_000
const LEAD_MS = REMINDER_LEAD_HOURS * HOUR_MS

/** The instant a booking starts: `YYYY-MM-DD` + `HH:MM` read as Hong Kong time. */
export function bookingStartsAt(bookingDate: string, bookingTime: string): Date {
  return new Date(`${bookingDate}T${bookingTime.slice(0, 5)}:00+08:00`)
}

export interface ReminderCandidate {
  status: string
  bookingDate: string
  bookingTime: string
  createdAt: string
}

/**
 * Due when confirmed, now is in [start − 3h, start), and the booking was made
 * at least 3h before its time (a booking made later gets no reminder: spec
 * "Explicitly Not Handled").
 */
export function isReminderDue(b: ReminderCandidate, now: Date): boolean {
  if (b.status !== 'confirmed') return false
  const start = bookingStartsAt(b.bookingDate, b.bookingTime).getTime()
  const opensAt = start - LEAD_MS
  const t = now.getTime()
  return t >= opensAt && t < start && new Date(b.createdAt).getTime() <= opensAt
}

/** Bookings dated before this HK date are past retention (> 180 days ago). */
export function retentionCutoffDate(now: Date): string {
  const today = new Date(`${hongKongToday(now)}T00:00:00Z`)
  today.setUTCDate(today.getUTCDate() - RETENTION_DAYS)
  return today.toISOString().slice(0, 10)
}

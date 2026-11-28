/**
 * BOOK-007 (R5): staff may mark a booking as a no-show only when it is
 * confirmed, its date + time (Asia/Hong_Kong) has passed and no change
 * request is open on it (r1 F1). The mark RPC (mark_booking_no_show, 087)
 * applies the same rule, so this module only decides what the dashboard
 * offers, and why a refused mark was refused.
 */
import type { HongKongMoment } from '@/domain/ports/booking'
import { hongKongTime, hongKongToday } from './booking-submission'

export function hongKongMoment(now: Date): HongKongMoment {
  return { date: hongKongToday(now), time: hongKongTime(now) }
}

/** An earlier date, or today before the Hong Kong time now (HH:MM, so a 19:30 booking is past from 19:31). */
export function isPastBooking(b: { bookingDate: string; bookingTime: string }, now: HongKongMoment): boolean {
  return b.bookingDate < now.date || (b.bookingDate === now.date && b.bookingTime < now.time)
}

export interface NoShowCandidate {
  status: string
  bookingDate: string
  bookingTime: string
  openChange?: unknown
  /** BOOK-013 (R14): arrived and no-show are mutually exclusive. */
  checkedInAt?: string | null
}

/** r1 F1: an original with an open change request is decided through its change row, never marked. */
export function canMarkNoShow(b: NoShowCandidate, now: Date): boolean {
  return b.status === 'confirmed' && !b.openChange && !b.checkedInAt && isPastBooking(b, hongKongMoment(now))
}

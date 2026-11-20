/**
 * BOOK-007 (R5): staff may mark a booking as a no-show only when it is
 * confirmed and its date + time (Asia/Hong_Kong) has passed. The repository
 * applies the same rule in its conditional UPDATE (`pastFilter`), so this
 * module only decides whether the dashboard offers the action.
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

export function canMarkNoShow(b: { status: string; bookingDate: string; bookingTime: string }, now: Date): boolean {
  return b.status === 'confirmed' && isPastBooking(b, hongKongMoment(now))
}

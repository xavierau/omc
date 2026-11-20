/**
 * BOOK-008: a member's bookings as staff see them on the member panel, and the
 * booking ↔ member link staff can edit by hand.
 *
 * `booking_requests.member_id` only records "this booking is this member's" for
 * staff. It never decides who is messaged or what a diner or agent sees: those
 * stay scoped by the booking's phone (threat R3).
 */
import type { BookingStatus } from './booking-request'

/** R8: the member panel lists at most this many bookings, newest first; the stats cover all of them. */
export const MEMBER_BOOKINGS_LIMIT = 50

/** R4: the audit row written for each manual link, relink or unlink (events.type, migration 088). */
export const BOOKING_MEMBER_RELINKED_EVENT = 'booking.member_relinked'

export interface MemberBookingItem {
  id: string
  bookingDate: string
  /** HH:MM */
  bookingTime: string
  partySize: number
  status: Exclude<BookingStatus, 'unverified'>
}

/**
 * R8: over every booking of the member (unverified excluded), computed in SQL.
 * r1 F2: the counts are reservations, not rows: an original cancelled by a
 * confirmed change, and a pending or declined change request, are not counted.
 */
export interface MemberBookingStats {
  total: number
  confirmed: number
  cancelled: number
  declined: number
  noShow: number
  pending: number
  /** The latest date before now (Hong Kong) of a confirmed or no_show booking; null when none. */
  lastBookingDate: string | null
  /** The earliest pending or confirmed booking date from now on; null when none. */
  nextBookingDate: string | null
}

export interface MemberBookingHistory {
  bookings: MemberBookingItem[]
  stats: MemberBookingStats
}

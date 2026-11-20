/**
 * BOOK-008: composition root for the booking ↔ member use cases, kept apart
 * from booking-deps.ts so the members route does not load the whole booking
 * graph (senders, queues). Tests pass in-memory fakes instead.
 */
import { bookingMemberLinkStore, memberBookingsReader } from '@/infrastructure/supabase/repositories/booking-member-repository'
import type { RelinkBookingMemberDeps } from './relink-booking-member'
import type { MemberBookingHistoryDeps } from './get-member-booking-history'

export function relinkBookingMemberDeps(): RelinkBookingMemberDeps {
  return { store: bookingMemberLinkStore }
}

export function memberBookingHistoryDeps(): MemberBookingHistoryDeps {
  return { reader: memberBookingsReader, now: () => new Date() }
}

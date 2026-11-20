/**
 * BOOK-008: ports for the booking ↔ member link. Every read and write is
 * scoped by restaurant inside the query (threat R2; memory
 * principle_authorize_by_scoped_query). Supabase adapter:
 * `src/infrastructure/supabase/repositories/booking-member-repository.ts`.
 */
import type { BookingRequest } from '@/domain/entities/booking-request'
import type { MemberBookingItem, MemberBookingStats } from '@/domain/entities/member-booking'
import type { HongKongMoment } from './booking'

export interface RelinkBookingMemberArgs {
  id: string
  restaurantId: string
  /** The link the caller read: the write changes the row only while it still holds this (compare-and-set). */
  fromMemberId: string | null
  toMemberId: string | null
  actorUserId: string
}

export interface BookingMemberLinkStore {
  /** Staff lookup: never returns an unverified agent booking (BOOK-003 R41). */
  findBooking(id: string, restaurantId: string): Promise<BookingRequest | null>
  /** True only for a member of this restaurant. */
  memberExists(memberId: string, restaurantId: string): Promise<boolean>
  /**
   * R2/R4: one statement (RPC relink_booking_member, migration 088): the
   * compare-and-set UPDATE and its `booking.member_relinked` events row
   * commit together. Null, and no event, when no row changed.
   */
  relink(args: RelinkBookingMemberArgs): Promise<BookingRequest | null>
}

export interface MemberBookingsReader {
  /** R8: newest `limit` bookings by date and time, scoped by restaurant AND member, unverified excluded. */
  list(memberId: string, restaurantId: string, limit: number): Promise<MemberBookingItem[]>
  /** R8: counts and dates over all the member's bookings, in SQL (RPC member_booking_stats, migration 088). */
  stats(memberId: string, restaurantId: string, now: HongKongMoment): Promise<MemberBookingStats>
}

/**
 * BOOK-008 (R8): a member's bookings for the member panel: the newest 50 by
 * booking date and time, and stats over all of them, both scoped by
 * restaurant AND member. "Now" (past vs upcoming) is the Hong Kong minute.
 * Never throws: a failed read (or migration 088 not yet applied) answers null
 * so the rest of the member panel still loads (memory
 * principle_shared_select_migration_coupling); the error is logged by name.
 */
import { MEMBER_BOOKINGS_LIMIT, type MemberBookingHistory } from '@/domain/entities/member-booking'
import type { MemberBookingsReader } from '@/domain/ports/booking-member'
import { hongKongMoment } from '@/domain/services/booking-no-show'

export interface MemberBookingHistoryDeps {
  reader: MemberBookingsReader
  now(): Date
}

export async function getMemberBookingHistory(
  deps: MemberBookingHistoryDeps,
  memberId: string,
  restaurantId: string
): Promise<MemberBookingHistory | null> {
  try {
    const [bookings, stats] = await Promise.all([
      deps.reader.list(memberId, restaurantId, MEMBER_BOOKINGS_LIMIT),
      deps.reader.stats(memberId, restaurantId, hongKongMoment(deps.now())),
    ])
    return { bookings, stats }
  } catch (err) {
    console.warn('[Members] booking history unavailable:', (err as Error).message)
    return null
  }
}

/**
 * BOOK-008 (R2, R4): staff link a booking to a member, move it to another
 * member, or unlink it. The booking and the target member are both resolved
 * inside the caller's restaurant; a miss of either (other tenant, unknown,
 * malformed id, unverified agent booking) is not_found and changes nothing.
 * The write is one compare-and-set statement with its audit row (RPC
 * relink_booking_member), so the events row's "from" is the link the row
 * really held; if another tap changed it first, the caller gets `conflict`.
 * r1 F5: no row changed is re-checked: a target member gone by then (deleted
 * between the lookup and the write) is not_found, like one never there.
 * No change requested (same member, or already unlinked): ok, no events row.
 * BOOK-013 AC-26: a booking without a phone cannot be linked (phone_required,
 * nothing written); the next phone-less save would drop the link. Unlinking
 * stays allowed.
 */
import { hasPhone, type BookingRequest } from '@/domain/entities/booking-request'
import type { BookingMemberLinkStore } from '@/domain/ports/booking-member'

export interface RelinkBookingMemberDeps {
  store: BookingMemberLinkStore
}

export interface RelinkBookingMemberInput {
  restaurantId: string
  userId: string
  bookingId: string
  /** Parsed from the body: a member id string, or null to unlink. */
  memberId: string | null
}

export type RelinkBookingMemberResult =
  | { ok: true; booking: BookingRequest }
  | { ok: false; reason: 'not_found' | 'conflict' | 'phone_required' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NOT_FOUND = { ok: false, reason: 'not_found' } as const

async function targetExists(deps: RelinkBookingMemberDeps, input: RelinkBookingMemberInput): Promise<boolean> {
  if (input.memberId === null) return true
  return UUID.test(input.memberId) && deps.store.memberExists(input.memberId, input.restaurantId)
}

export async function relinkBookingMember(
  deps: RelinkBookingMemberDeps,
  input: RelinkBookingMemberInput
): Promise<RelinkBookingMemberResult> {
  if (!UUID.test(input.bookingId)) return NOT_FOUND
  const booking = await deps.store.findBooking(input.bookingId, input.restaurantId)
  if (!booking) return NOT_FOUND
  if (input.memberId !== null && !hasPhone(booking)) return { ok: false, reason: 'phone_required' }
  if (!(await targetExists(deps, input))) return NOT_FOUND
  if (booking.memberId === input.memberId) return { ok: true, booking }
  const changed = await deps.store.relink({
    id: booking.id,
    restaurantId: input.restaurantId,
    fromMemberId: booking.memberId,
    toMemberId: input.memberId,
    actorUserId: input.userId,
  })
  if (changed) return { ok: true, booking: changed }
  return (await targetExists(deps, input)) ? { ok: false, reason: 'conflict' } : NOT_FOUND
}

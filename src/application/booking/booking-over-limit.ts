/**
 * BOOK-010 (spec AC-10): would confirming this pending request take its slot
 * or its meal over a guest limit? Staff are asked, never blocked.
 *
 * A pending request already counts (pending + confirmed), so the count after
 * confirming is today's count; for a change request, the original it
 * replaces is cancelled by the confirm, so the original's guests come off
 * when it sits in the same slot / meal.
 */
import type { BookingRequest } from '@/domain/entities/booking-request'
import type { BookingRoomReader } from '@/domain/ports/booking'
import { periodAt, periodGuests, periodKey, roomApplies, slotGuests, type GuestCounts } from '@/domain/services/booking-room'
import { limitsOf } from '@/domain/value-objects/booking-limits'
import type { BookingConfig } from '@/domain/value-objects/booking-config'

export type OverLimit =
  | { scope: 'slot'; time: string; guests: number; limit: number }
  | { scope: 'meal'; period: string; guests: number; limit: number }

export interface OverLimitDeps {
  getConfig(restaurantId: string): Promise<BookingConfig>
  room: BookingRoomReader
}

type Slot = Pick<BookingRequest, 'bookingDate' | 'bookingTime' | 'partySize' | 'status'>

/** The counts with the replaced original taken off (it is cancelled by the confirm). */
function withoutOriginal(counts: GuestCounts, date: string, original: Slot | null): GuestCounts {
  if (!original || original.bookingDate !== date || !['pending', 'confirmed'].includes(original.status)) return counts
  const day = { ...(counts[date] ?? {}) }
  day[original.bookingTime] = (day[original.bookingTime] ?? 0) - original.partySize
  return { ...counts, [date]: day }
}

export async function overLimitFor(deps: OverLimitDeps, booking: BookingRequest, original: Slot | null): Promise<OverLimit | null> {
  const hours = (await deps.getConfig(booking.restaurantId)).bookingHours
  if (!roomApplies(hours) || booking.status !== 'pending') return null
  const { perSlot, perMeal } = limitsOf(hours)
  if (perSlot === null && perMeal === null) return null
  const date = booking.bookingDate
  const counts = withoutOriginal((await deps.room.readRoom(booking.restaurantId, date, date)).counts, date, original)
  const atSlot = slotGuests(counts, date, booking.bookingTime)
  if (perSlot !== null && atSlot > perSlot) return { scope: 'slot', time: booking.bookingTime, guests: atSlot, limit: perSlot }
  const period = periodAt(hours, date, booking.bookingTime)
  const atMeal = period ? periodGuests(counts, date, period) : 0
  if (period && perMeal !== null && atMeal > perMeal) return { scope: 'meal', period: periodKey(period), guests: atMeal, limit: perMeal }
  return null
}

/**
 * BOOK-013: the message a staff create / edit / cancel sends for a kind, built
 * as BOOK-001 builds a decision's message. Notes are never part of any message.
 */
import type { BookingWithPhone } from '@/domain/entities/booking-request'
import type { BookingMessageInput, BookingSettingsReader } from '@/domain/ports/booking'
import type { BookingMessageKind } from '@/domain/services/booking-message'

export interface BookingMessageForDeps {
  settings: Pick<BookingSettingsReader, 'getRestaurant'>
}

/** Only a booking with a phone can be messaged (decision 9, R19). */
export async function bookingMessageFor(deps: BookingMessageForDeps, booking: BookingWithPhone, kind: BookingMessageKind): Promise<BookingMessageInput> {
  const restaurant = await deps.settings.getRestaurant(booking.restaurantId)
  return {
    restaurantId: booking.restaurantId,
    phone: booking.phone,
    memberId: booking.memberId,
    kind,
    details: {
      restaurantName: restaurant?.name ?? '',
      name: booking.name,
      date: booking.bookingDate,
      time: booking.bookingTime,
      partySize: booking.partySize,
      declineReason: booking.declineReason,
    },
  }
}

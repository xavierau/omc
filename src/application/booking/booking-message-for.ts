/**
 * BOOK-013: the message a booking sends for a kind. A confirmation carries
 * the check-in code and the booking's QR link (spec AC-17); every other kind
 * is the BOOK-001 message as before. Notes are never part of any message.
 */
import type { BookingRequest } from '@/domain/entities/booking-request'
import type { BookingMessageInput, BookingSettingsReader } from '@/domain/ports/booking'
import type { BookingMessageKind } from '@/domain/services/booking-message'
import type { CheckinQrStore } from '@/domain/ports/staff-booking'

export interface BookingMessageForDeps {
  settings: Pick<BookingSettingsReader, 'getRestaurant'>
  /** Absent: no QR link (a QR-header template then reports not delivered). */
  qr?: CheckinQrStore
}

async function qrFor(deps: BookingMessageForDeps, booking: BookingRequest, kind: BookingMessageKind) {
  if (kind !== 'confirmed' || !booking.checkinCode || !deps.qr) return {}
  return { image: await deps.qr.ensure({ id: booking.id, restaurantId: booking.restaurantId, checkinCode: booking.checkinCode }) }
}

export async function bookingMessageFor(deps: BookingMessageForDeps, booking: BookingRequest, kind: BookingMessageKind): Promise<BookingMessageInput> {
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
      ...(kind === 'confirmed' && booking.checkinCode ? { checkinCode: booking.checkinCode } : {}),
    },
    ...(await qrFor(deps, booking, kind)),
  }
}

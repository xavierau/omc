/**
 * BOOK-014 W3 (spec AC-6): the booking page's paid-event hook. A /b booking
 * (chat or campaign link) gets the existing "received" message when its
 * deposit is paid, not at submit. handlePaymentEvent calls the hook only on
 * the one transition that moved the booking out of awaiting_deposit, so a
 * replayed or late event sends nothing (W1 CAS + webhook idempotency). Other
 * channels' bookings (agent, staff) are left to their own work items.
 * Best effort: a send failure is logged by the caller and never undoes the payment.
 */
import { notifyReceived } from '@/application/booking/submit-booking-request'
import type { BookingLinkSource } from '@/domain/services/booking-token'
import type { BookingMessageSender, BookingSettingsReader } from '@/domain/ports/booking'
import type { DepositPaid } from './handle-payment-event'

const BOOKING_PAGE_SOURCES: readonly string[] = ['chat', 'campaign'] satisfies readonly BookingLinkSource[]

export interface BookingPagePaidHookDeps {
  settings: Pick<BookingSettingsReader, 'getRestaurant'>
  sender: BookingMessageSender
}

export function bookingPagePaidHook(deps: BookingPagePaidHookDeps): (paid: DepositPaid) => Promise<void> {
  return async ({ booking }) => {
    if (!BOOKING_PAGE_SOURCES.includes(booking.source) || booking.status !== 'pending') return
    await notifyReceived(deps, booking)
  }
}

/**
 * BOOK-014 W3 (spec AC-5..AC-7; threat R62): what a live /p/<token> page
 * shows about the booking its deposit holds: the slot only. Never the diner's
 * name, phone or notes. Scoped by the deposit's own restaurant and booking ids.
 * Adapter: infrastructure/supabase/repositories/payment-link-details-repository.ts.
 * W6a: plus the booking status, so a cancelled / no-show booking with a paid
 * deposit reads "held" (not "request sent"). The status is not shown.
 */
import type { BookingStatus } from '@/domain/entities/booking-request'

export interface PaymentLinkBookingSlot {
  bookingDate: string
  /** HH:MM */
  bookingTime: string
  partySize: number
  bookingStatus: BookingStatus
}

export interface PaymentLinkDetailsReader {
  findForDeposit(ref: { restaurantId: string; bookingId: string }): Promise<PaymentLinkBookingSlot | null>
}

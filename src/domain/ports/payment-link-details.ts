/**
 * BOOK-014 W3 (spec AC-5..AC-7; threat R62): what a live /p/<token> page
 * shows about the booking its deposit holds: the slot only. Never the diner's
 * name, phone or notes. Scoped by the deposit's own restaurant and booking ids.
 * Adapter: infrastructure/supabase/repositories/payment-link-details-repository.ts.
 */
export interface PaymentLinkBookingSlot {
  bookingDate: string
  /** HH:MM */
  bookingTime: string
  partySize: number
}

export interface PaymentLinkDetailsReader {
  findForDeposit(ref: { restaurantId: string; bookingId: string }): Promise<PaymentLinkBookingSlot | null>
}

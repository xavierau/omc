/**
 * BOOK-014 W3 (threat R62): the /p page's booking read. Selects the slot
 * columns only (no name, phone or notes) and is scoped by booking id AND
 * restaurant id. It reads awaiting_deposit and lapsed bookings too, which the
 * staff readers hide; the page decides which states show anything.
 */
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import type { PaymentLinkBookingSlot, PaymentLinkDetailsReader } from '@/domain/ports/payment-link-details'

export const PAYMENT_LINK_DETAIL_COLUMNS = 'booking_date, booking_time, party_size'

interface SlotRow {
  booking_date: string
  booking_time: string
  party_size: number
}

/** 22P02 = not a uuid: a miss, like an unknown id. */
async function findPaymentLinkDetails(ref: { restaurantId: string; bookingId: string }): Promise<PaymentLinkBookingSlot | null> {
  const { data, error } = await createServerSupabaseClient()
    .from('booking_requests')
    .select(PAYMENT_LINK_DETAIL_COLUMNS)
    .eq('id', ref.bookingId)
    .eq('restaurant_id', ref.restaurantId)
    .maybeSingle()
  if ((error as { code?: string } | null)?.code === '22P02') return null
  if (error) throw new Error(`findPaymentLinkDetails: ${error.message}`)
  if (!data) return null
  const row = data as SlotRow
  return { bookingDate: row.booking_date, bookingTime: row.booking_time.slice(0, 5), partySize: row.party_size }
}

export const paymentLinkDetailsReader: PaymentLinkDetailsReader = { findForDeposit: findPaymentLinkDetails }

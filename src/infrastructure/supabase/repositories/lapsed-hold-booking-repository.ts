/**
 * BOOK-014 W6a: the lapse hook's booking read (notify-agent-hold-lapsed.ts).
 * Agent bookings only, by id in short chunks (PostgREST echoes the filter in
 * a response header, so a long id list can overflow it), and each row must
 * belong to the restaurant of the deposit that named it. The status token
 * hash is read only to tell a personal agent (PAP) booking from an AI agent
 * one; it never leaves this adapter.
 */
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import type { BookingSource } from '@/domain/entities/booking-request'
import type { LapsedHoldBooking, LapsedHoldBookingReader } from '@/domain/ports/booking-deposit'

/** One expiry batch is at most 200 lapses; 50 ids keep the URL and its echoed header short. */
export const LAPSED_HOLD_CHUNK = 50

const COLUMNS = 'id, restaurant_id, phone, source, status_token_hash, booking_date, booking_time, party_size'

interface Row {
  id: string
  restaurant_id: string
  phone: string | null
  source: BookingSource
  status_token_hash: string | null
  booking_date: string
  booking_time: string
  party_size: number
}

const toHold = (row: Row): LapsedHoldBooking => ({
  id: row.id,
  restaurantId: row.restaurant_id,
  phone: row.phone,
  source: row.source,
  personalAgent: row.status_token_hash !== null,
  bookingDate: row.booking_date,
  bookingTime: row.booking_time.slice(0, 5),
  partySize: row.party_size,
})

async function findLapsedHoldBookings(refs: ReadonlyArray<{ restaurantId: string; bookingId: string }>): Promise<LapsedHoldBooking[]> {
  const restaurantOf = new Map(refs.map((r) => [r.bookingId, r.restaurantId]))
  const ids = [...restaurantOf.keys()]
  const out: LapsedHoldBooking[] = []
  for (let i = 0; i < ids.length; i += LAPSED_HOLD_CHUNK) {
    const { data, error } = await createServerSupabaseClient()
      .from('booking_requests')
      .select(COLUMNS)
      .in('id', ids.slice(i, i + LAPSED_HOLD_CHUNK))
      .eq('source', 'agent')
    if (error) throw new Error(`findLapsedHoldBookings: ${error.message}`)
    for (const row of (data ?? []) as Row[]) if (restaurantOf.get(row.id) === row.restaurant_id) out.push(toHold(row))
  }
  return out
}

export const lapsedHoldBookingReader: LapsedHoldBookingReader = { findForDeposits: findLapsedHoldBookings }

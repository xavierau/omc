/**
 * BOOK-001 AC-13: this restaurant's booking requests, newest first: every
 * pending one plus the newest 200 decided ones (F10). The
 * restaurant comes from the session's tenant context and scopes the query
 * itself (R6); any tenant member may read (floor staff need it).
 * BOOK-004: `?from&to` (YYYY-MM-DD, inclusive) instead lists the bookings
 * dated in that range by date and time, capped (`truncated`); both shapes
 * carry `pendingCount`, every pending request of the restaurant.
 */
import { NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import {
  countRestaurantPendingBookings,
  listBookingRequests,
  listBookingRequestsInRange,
} from '@/infrastructure/supabase/repositories/booking-request-repository'
import {
  BOOKINGS_RANGE_CAP,
  DECIDED_BOOKINGS_LIST_LIMIT,
  parseBookingRange,
  type BookingDateRange,
} from '@/domain/entities/booking-request'

const NO_STORE = { 'Cache-Control': 'no-store' }

async function listBody(restaurantId: string, range: BookingDateRange | null) {
  const pending = countRestaurantPendingBookings(restaurantId)
  if (!range) {
    const [bookings, pendingCount] = await Promise.all([listBookingRequests(restaurantId, DECIDED_BOOKINGS_LIST_LIMIT), pending])
    return { bookings, pendingCount }
  }
  const [list, pendingCount] = await Promise.all([listBookingRequestsInRange(restaurantId, range, BOOKINGS_RANGE_CAP), pending])
  return { ...list, pendingCount }
}

export async function GET(request: Request) {
  try {
    const { restaurantId } = await getTenantContext()
    const params = new URL(request.url).searchParams
    const parsed = parseBookingRange(params.get('from'), params.get('to'))
    if (!parsed.ok) return NextResponse.json({ error: 'invalid_range' }, { status: 400, headers: NO_STORE })
    return NextResponse.json(await listBody(restaurantId, parsed.range), { headers: NO_STORE })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('[Bookings] list failed:', (error as Error).message)
    return NextResponse.json({ error: 'Failed to load bookings' }, { status: 500 })
  }
}

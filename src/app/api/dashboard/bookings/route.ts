/**
 * BOOK-001 AC-13: this restaurant's booking requests, newest first: every
 * pending one plus the newest 200 decided ones (F10). The
 * restaurant comes from the session's tenant context and scopes the query
 * itself (R6); any tenant member may read (floor staff need it).
 */
import { NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { listBookingRequests } from '@/infrastructure/supabase/repositories/booking-request-repository'
import { DECIDED_BOOKINGS_LIST_LIMIT } from '@/domain/entities/booking-request'

export async function GET() {
  try {
    const { restaurantId } = await getTenantContext()
    const bookings = await listBookingRequests(restaurantId, DECIDED_BOOKINGS_LIST_LIMIT)
    return NextResponse.json({ bookings }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('[Bookings] list failed:', (error as Error).message)
    return NextResponse.json({ error: 'Failed to load bookings' }, { status: 500 })
  }
}

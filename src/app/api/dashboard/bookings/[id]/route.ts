/** BOOK-001: one booking request, scoped to the session's restaurant inside the query (R6). */
import { NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { findBookingForRestaurant } from '@/infrastructure/supabase/repositories/booking-request-repository'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { restaurantId } = await getTenantContext()
    const { id } = await params
    const booking = UUID.test(id) ? await findBookingForRestaurant(id, restaurantId) : null
    if (!booking) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    return NextResponse.json({ booking }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('[Bookings] get failed:', (error as Error).message)
    return NextResponse.json({ error: 'Failed to load booking' }, { status: 500 })
  }
}

/**
 * BOOK-007 (R5, R6): POST marks a past confirmed booking as a no-show; DELETE
 * undoes it (back to confirmed). Tenant from the session, roles admin and
 * staff (like confirm/decline), 409 when the booking is not in the state the
 * move needs, 404 for a missing, malformed or other-tenant id. No message is
 * sent to the diner either way.
 */
import { NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { noShowBookingDeps } from '@/application/booking/booking-deps'
import { markBookingNoShow, undoBookingNoShow, type NoShowResult } from '@/application/booking/booking-no-show'

type Params = { params: Promise<{ id: string }> }
type Move = typeof markBookingNoShow

const STAFF_ROLES = ['admin', 'staff']

function respond(result: NoShowResult): NextResponse {
  if (result.ok) return NextResponse.json({ booking: result.booking })
  if (result.reason === 'already_handled') {
    return NextResponse.json({ error: 'already_handled', status: result.status }, { status: 409 })
  }
  return NextResponse.json({ error: 'not_found' }, { status: 404 })
}

async function handle(params: Params['params'], move: Move): Promise<NextResponse> {
  try {
    const { restaurantId, userId, role } = await getTenantContext()
    if (!STAFF_ROLES.includes(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const { id } = await params
    return respond(await move(noShowBookingDeps(), { restaurantId, userId, bookingId: id }))
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('[Bookings] no-show failed:', (error as Error).message)
    return NextResponse.json({ error: 'Failed to update booking' }, { status: 500 })
  }
}

export function POST(_request: Request, { params }: Params) {
  return handle(params, markBookingNoShow)
}

export function DELETE(_request: Request, { params }: Params) {
  return handle(params, undoBookingNoShow)
}

/**
 * BOOK-013 S7 (AC-21, AC-22; R14): POST = Arrived, DELETE = Undo. Admin/staff
 * (R1), restaurant from the session (R2). 409 with the reason (not_today,
 * not_confirmed, already_arrived, open_change, not_arrived, booking_off); 404
 * for a missing, malformed or other-tenant id.
 */
import { NextResponse } from 'next/server'
import { checkInBooking, undoCheckIn, type CheckInResult } from '@/application/booking/booking-check-in'
import { bookingCheckInDeps } from '@/application/booking/booking-deps'
import { failure, NO_STORE, staffContext } from '../../staff-access'

type Params = { params: Promise<{ id: string }> }

function respond(result: CheckInResult): NextResponse {
  if (result.ok) return NextResponse.json({ booking: result.booking }, { headers: NO_STORE })
  if (result.reason === 'not_found') return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE })
  const status = 'status' in result ? { status: result.status } : {}
  return NextResponse.json({ error: result.reason, ...status }, { status: 409, headers: NO_STORE })
}

async function handle(params: Params['params'], move: typeof checkInBooking) {
  try {
    const ctx = await staffContext()
    if (ctx instanceof NextResponse) return ctx
    const { id } = await params
    return respond(await move(bookingCheckInDeps(), { restaurantId: ctx.restaurantId, userId: ctx.userId, bookingId: id }))
  } catch (error) {
    return failure(error, 'update check-in')
  }
}

export function POST(_request: Request, { params }: Params) {
  return handle(params, checkInBooking)
}

export function DELETE(_request: Request, { params }: Params) {
  return handle(params, undoCheckIn)
}

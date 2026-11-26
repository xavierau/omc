/**
 * BOOK-013 S7 (AC-21, AC-24; R2, R15): the booking a typed or scanned
 * check-in code belongs to, among THIS restaurant's live bookings only.
 * Text that is not code-shaped is not looked up. A miss is 404 with nothing
 * else, so a code reveals nothing about another restaurant.
 */
import { NextResponse } from 'next/server'
import { findBookingByCode } from '@/application/booking/booking-check-in'
import { bookingCheckInDeps } from '@/application/booking/booking-deps'
import { failure, NO_STORE, staffContext } from '../../staff-access'

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const ctx = await staffContext()
    if (ctx instanceof NextResponse) return ctx
    const { code } = await params
    const found = await findBookingByCode(bookingCheckInDeps(), ctx.restaurantId, decodeURIComponent(code))
    if (!found.ok) return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE })
    return NextResponse.json({ booking: found.booking, today: found.today }, { headers: NO_STORE })
  } catch (error) {
    return failure(error, 'find booking')
  }
}

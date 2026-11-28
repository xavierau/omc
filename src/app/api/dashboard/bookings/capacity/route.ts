/**
 * BOOK-010 (spec S3, AC-8, AC-9): how full the restaurant's days are.
 * `?date=YYYY-MM-DD` → the day panel's capacity block (per period guests /
 * limit / stop, expandable slots); `?from&to` (≤ 62 days) → per-date
 * `{full, stopped}` for the calendar month badges. Admin or staff of the
 * session's tenant; scoped by it inside every read (threat R3).
 */
import { NextResponse } from 'next/server'
import { getBookingCapacity } from '@/application/booking/booking-capacity'
import { bookingCapacityDeps } from '@/application/booking/booking-deps'
import { failure, NO_STORE, staffContext } from '../staff-access'

export async function GET(request: Request) {
  try {
    const ctx = await staffContext()
    if (ctx instanceof NextResponse) return ctx
    const params = new URL(request.url).searchParams
    const query = { date: params.get('date'), from: params.get('from'), to: params.get('to') }
    const result = await getBookingCapacity(bookingCapacityDeps(), { restaurantId: ctx.restaurantId, query })
    if (!result.ok) return NextResponse.json({ error: 'invalid', fields: result.errors }, { status: 400, headers: NO_STORE })
    return NextResponse.json(result.body, { headers: NO_STORE })
  } catch (error) {
    return failure(error, 'load capacity')
  }
}

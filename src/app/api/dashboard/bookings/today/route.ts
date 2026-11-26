/**
 * BOOK-013 S7 (R12): today's (Hong Kong) pending, confirmed and no-show
 * bookings of the session's restaurant, by time, capped at 300 (`truncated`).
 * Admin/staff only (R1). Search runs in the browser over this list.
 */
import { NextResponse } from 'next/server'
import { listTodayBookings } from '@/application/booking/booking-check-in'
import { bookingCheckInDeps } from '@/application/booking/booking-deps'
import { withCreatorNames } from '@/application/booking/booking-creator-names'
import { findStaffDisplayName } from '@/infrastructure/supabase/repositories/booking-room-repository'
import { failure, NO_STORE, staffContext } from '../staff-access'

export async function GET() {
  try {
    const ctx = await staffContext()
    if (ctx instanceof NextResponse) return ctx
    const today = await listTodayBookings(bookingCheckInDeps(), ctx.restaurantId)
    return NextResponse.json({ ...today, bookings: await withCreatorNames(today.bookings, findStaffDisplayName) }, { headers: NO_STORE })
  } catch (error) {
    return failure(error, 'load today')
  }
}

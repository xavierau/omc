/**
 * BOOK-001: one booking request, scoped to the session's restaurant inside the query (R6).
 * BOOK-013 S2: PATCH = staff edit (admin/staff, R1; conditional on the loaded editVersion, R3).
 */
import { NextRequest, NextResponse } from 'next/server'
import { editStaffBooking } from '@/application/booking/edit-staff-booking'
import { staffBookingDeps } from '@/application/booking/booking-deps'
import { failure, staffContext } from '../staff-access'
import { readJson, staffBookingResponse } from '../staff-response'
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

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await staffContext()
    if (ctx instanceof NextResponse) return ctx
    const { id } = await params
    const body = await readJson(request)
    return staffBookingResponse(await editStaffBooking(staffBookingDeps(), { restaurantId: ctx.restaurantId, userId: ctx.userId, bookingId: id, body }))
  } catch (error) {
    return failure(error, 'update booking')
  }
}

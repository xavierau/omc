/** BOOK-013 S3: staff cancel a confirmed booking (soft cancel; admin/staff, R1; conditional, R3). */
import { NextRequest, NextResponse } from 'next/server'
import { cancelStaffBooking } from '@/application/booking/cancel-staff-booking'
import { staffBookingDeps } from '@/application/booking/booking-deps'
import { failure, staffContext } from '../../staff-access'
import { readJson, staffBookingResponse } from '../../staff-response'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await staffContext()
    if (ctx instanceof NextResponse) return ctx
    const { id } = await params
    const body = await readJson(request)
    return staffBookingResponse(await cancelStaffBooking(staffBookingDeps(), { restaurantId: ctx.restaurantId, userId: ctx.userId, bookingId: id, body }))
  } catch (error) {
    return failure(error, 'cancel booking')
  }
}

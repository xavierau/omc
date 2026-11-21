/**
 * BOOK-010 (spec S3, AC-8, AC-9, AC-11; threat R3): stop (POST) or resume
 * (DELETE) bookings for a day, a period or a slot:
 * `{date, scope: 'day'|'period'|'slot', periodLabel?, time?}`. Both are
 * idempotent; a past date, or a period / slot not on that date, is a 400.
 * Admin or staff of the session's tenant; the stop is written for that
 * tenant only. Stops bind diners and agents, never staff.
 */
import { NextRequest, NextResponse } from 'next/server'
import { changeBookingStop } from '@/application/booking/booking-capacity'
import { bookingCapacityDeps } from '@/application/booking/booking-deps'
import { failure, NO_STORE, staffContext } from '../staff-access'

async function change(request: NextRequest, action: 'stop' | 'resume'): Promise<NextResponse> {
  try {
    const ctx = await staffContext()
    if (ctx instanceof NextResponse) return ctx
    const body = await request.json().catch(() => null)
    const result = await changeBookingStop(bookingCapacityDeps(), { restaurantId: ctx.restaurantId, userId: ctx.userId, action, body })
    if (!result.ok) return NextResponse.json({ error: 'invalid', fields: result.errors }, { status: 400, headers: NO_STORE })
    return NextResponse.json(action === 'stop' ? { stop: result.stop } : { removed: true }, { headers: NO_STORE })
  } catch (error) {
    return failure(error, action === 'stop' ? 'stop bookings' : 'resume bookings')
  }
}

export const POST = (request: NextRequest) => change(request, 'stop')
export const DELETE = (request: NextRequest) => change(request, 'resume')

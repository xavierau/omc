/**
 * BOOK-014 W4 (spec UI states, AC-11): the payment link of a staff booking
 * still awaiting its deposit, for Copy link. Admin or staff of the session's
 * tenant (R58); 200 {url}; 404 foreign or unknown id; 409 when the booking is
 * not a staff booking awaiting its deposit (paid, lapsed, diner-made).
 */
import { NextResponse } from 'next/server'
import { staffDepositLink } from '@/application/payments/deposit-decisions'
import { staffDepositLinkDeps } from '@/application/payments/payment-deps'
import { UUID } from '@/application/booking/staff-booking-shared'
import { NO_STORE, failure, staffContext } from '../../../staff-access'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await staffContext()
    if (ctx instanceof NextResponse) return ctx
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE })
    const result = await staffDepositLink(staffDepositLinkDeps(), { restaurantId: ctx.restaurantId, bookingId: id })
    if (result.ok) return NextResponse.json({ url: result.url }, { headers: NO_STORE })
    return NextResponse.json({ error: result.reason }, { status: result.reason === 'not_found' ? 404 : 409, headers: NO_STORE })
  } catch (error) {
    return failure(error, 'read payment link')
  }
}

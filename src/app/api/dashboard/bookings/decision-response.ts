/**
 * BOOK-001 AC-14: shared handler for confirm and decline. Tenant from the
 * session (R6), acting user recorded (R5), 409 when another tap already
 * decided (R4), 404 for a missing or other-tenant id.
 * BOOK-010 (spec AC-10): a confirm over a guest limit → 409 over_limit with
 * the facts; the same call with `{confirmAnyway: true}` confirms.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { decideBookingRequest } from '@/application/booking/decide-booking-request'
import { decideBookingDeps } from '@/application/booking/booking-deps'
import type { BookingDecision } from '@/domain/entities/booking-request'

/** The optional JSON body: `reason` (decline) and BOOK-010 `confirmAnyway` (confirm). */
async function readBody(request: NextRequest): Promise<{ reason?: unknown; confirmAnyway?: unknown }> {
  try {
    const body = (await request.json()) as { reason?: unknown; confirmAnyway?: unknown } | null
    return body ?? {}
  } catch {
    return {}
  }
}

export async function handleBookingDecision(
  request: NextRequest,
  params: Promise<{ id: string }>,
  decision: BookingDecision
): Promise<NextResponse> {
  try {
    const { restaurantId, userId } = await getTenantContext()
    const { id } = await params
    const body = await readBody(request)
    const reason = decision === 'declined' ? body.reason : undefined
    const confirmAnyway = decision === 'confirmed' && body.confirmAnyway === true
    const result = await decideBookingRequest(decideBookingDeps(), { restaurantId, userId, bookingId: id, decision, reason, confirmAnyway })
    if (result.ok) return NextResponse.json({ booking: result.booking, delivered: result.delivered })
    // BOOK-010 (spec AC-10): nothing changed; the staff UI asks "Confirm anyway?" and sends confirmAnyway: true.
    if (result.reason === 'over_limit') return NextResponse.json({ error: 'over_limit', overLimit: result.overLimit }, { status: 409 })
    if (result.reason === 'already_handled') {
      return NextResponse.json({ error: 'already_handled', status: result.status }, { status: 409 })
    }
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('[Bookings] decision failed:', (error as Error).message)
    return NextResponse.json({ error: 'Failed to update booking' }, { status: 500 })
  }
}

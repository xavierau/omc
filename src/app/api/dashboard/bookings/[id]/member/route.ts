/**
 * BOOK-008 (R2, R4): PATCH links a booking to a member of the caller's
 * restaurant ({ memberId: uuid }), or unlinks it ({ memberId: null }). Tenant
 * from the session, roles admin and staff (as the no-show route). 404 for a
 * missing, malformed or other-tenant booking or member; 409 when another tap
 * changed the link first; 400 for a body without a string or null memberId.
 * The link is for staff only: nothing is sent to the diner.
 */
import { NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { relinkBookingMemberDeps } from '@/application/booking/member-booking-deps'
import { relinkBookingMember, type RelinkBookingMemberResult } from '@/application/booking/relink-booking-member'
import { isStaffRole } from '@/domain/value-objects/tenant-role'

type Params = { params: Promise<{ id: string }> }

/** The body's memberId: a string or null; anything else (missing, wrong type, not JSON) is undefined. */
async function readMemberId(request: Request): Promise<string | null | undefined> {
  try {
    const body = (await request.json()) as { memberId?: unknown } | null
    const value = body?.memberId
    return value === null || typeof value === 'string' ? value : undefined
  } catch {
    return undefined
  }
}

function respond(result: RelinkBookingMemberResult): NextResponse {
  if (result.ok) return NextResponse.json({ booking: result.booking })
  if (result.reason === 'conflict') return NextResponse.json({ error: 'changed' }, { status: 409 })
  return NextResponse.json({ error: 'not_found' }, { status: 404 })
}

export async function PATCH(request: Request, { params }: Params): Promise<NextResponse> {
  try {
    const { restaurantId, userId, role } = await getTenantContext()
    if (!isStaffRole(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const memberId = await readMemberId(request)
    if (memberId === undefined) return NextResponse.json({ error: 'invalid_input' }, { status: 400 })
    const { id } = await params
    return respond(await relinkBookingMember(relinkBookingMemberDeps(), { restaurantId, userId, bookingId: id, memberId }))
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('[Bookings] member link failed:', (error as Error).message)
    return NextResponse.json({ error: 'Failed to update booking' }, { status: 500 })
  }
}

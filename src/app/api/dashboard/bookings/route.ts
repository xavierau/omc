/**
 * BOOK-001 AC-13: this restaurant's booking requests, newest first: every
 * pending one plus the newest 200 decided ones (F10). The
 * restaurant comes from the session's tenant context and scopes the query
 * itself (R6); any tenant member may read (floor staff need it).
 * BOOK-004: `?from&to` (YYYY-MM-DD, inclusive) instead lists the bookings
 * dated in that range by date and time, capped (`truncated`); both shapes
 * carry `pendingCount`, every pending request of the restaurant.
 * BOOK-004 r2: `?status=pending` (alone) lists every pending request, any
 * date, by date and time, capped: the rows behind `pendingCount`.
 * BOOK-013: staff-made rows carry the creator's display name ("By staff ·
 * Mandy"); POST adds a staff booking (admin/staff, R1; staff-response.ts).
 * BOOK-014 W4: rows carry their deposit; a range also carries `holds`, the
 * guests per date of diners' deposit holds (not listed, spec AC-5).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import {
  countRestaurantPendingBookings,
  listBookingRequests,
  listBookingRequestsInRange,
  listDepositHoldGuests,
  listPendingBookingRequests,
} from '@/infrastructure/supabase/repositories/booking-request-repository'
import { findStaffDisplayName } from '@/infrastructure/supabase/repositories/booking-room-repository'
import { withCreatorNames } from '@/application/booking/booking-creator-names'
import { createStaffBooking } from '@/application/booking/create-staff-booking'
import { staffBookingDeps } from '@/application/booking/booking-deps'
import { failure, staffContext } from './staff-access'
import { readJson, staffBookingResponse } from './staff-response'
import {
  BOOKINGS_RANGE_CAP,
  DECIDED_BOOKINGS_LIST_LIMIT,
  parseBookingRange,
  type BookingDateRange,
} from '@/domain/entities/booking-request'

const NO_STORE = { 'Cache-Control': 'no-store' }

type ListQuery = { kind: 'default' } | { kind: 'range'; range: BookingDateRange } | { kind: 'pending' }
type ParsedQuery = { ok: true; query: ListQuery } | { ok: false; error: 'invalid_range' | 'invalid_status' }

/** `status` accepts only `pending`, and never with a range; `from`/`to` per parseBookingRange. */
function parseListQuery(params: URLSearchParams): ParsedQuery {
  if (params.has('status')) {
    const alone = !params.has('from') && !params.has('to')
    return params.get('status') === 'pending' && alone ? { ok: true, query: { kind: 'pending' } } : { ok: false, error: 'invalid_status' }
  }
  const parsed = parseBookingRange(params.get('from'), params.get('to'))
  if (!parsed.ok) return { ok: false, error: 'invalid_range' }
  return { ok: true, query: parsed.range ? { kind: 'range', range: parsed.range } : { kind: 'default' } }
}

async function listBody(restaurantId: string, query: ListQuery) {
  const pending = countRestaurantPendingBookings(restaurantId)
  if (query.kind === 'default') {
    const [bookings, pendingCount] = await Promise.all([listBookingRequests(restaurantId, DECIDED_BOOKINGS_LIST_LIMIT), pending])
    return { bookings: await withCreatorNames(bookings, findStaffDisplayName), pendingCount }
  }
  const list =
    query.kind === 'range'
      ? listBookingRequestsInRange(restaurantId, query.range, BOOKINGS_RANGE_CAP)
      : listPendingBookingRequests(restaurantId, BOOKINGS_RANGE_CAP)
  // BOOK-014 W4 (review finding 9): diners' deposit holds are not rows, but they take seats; the calendar adds them.
  const holds = query.kind === 'range' ? listDepositHoldGuests(restaurantId, query.range) : Promise.resolve(undefined)
  const [rows, pendingCount, held] = await Promise.all([list, pending, holds])
  return { ...rows, bookings: await withCreatorNames(rows.bookings, findStaffDisplayName), pendingCount, ...(held ? { holds: held } : {}) }
}

export async function GET(request: Request) {
  try {
    const { restaurantId } = await getTenantContext()
    const parsed = parseListQuery(new URL(request.url).searchParams)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400, headers: NO_STORE })
    return NextResponse.json(await listBody(restaurantId, parsed.query), { headers: NO_STORE })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('[Bookings] list failed:', (error as Error).message)
    return NextResponse.json({ error: 'Failed to load bookings' }, { status: 500 })
  }
}

/** BOOK-013 S1: staff add a booking (confirmed, source staff). */
export async function POST(request: NextRequest) {
  try {
    const ctx = await staffContext()
    if (ctx instanceof NextResponse) return ctx
    const body = await readJson(request)
    const result = await createStaffBooking(staffBookingDeps(), { restaurantId: ctx.restaurantId, userId: ctx.userId, body })
    return staffBookingResponse(result, true)
  } catch (error) {
    return failure(error, 'add booking')
  }
}

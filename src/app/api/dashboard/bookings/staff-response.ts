/**
 * BOOK-013: how a staff create / edit / cancel answers (spec UI Feedback
 * States). Every route resolves the session first (401/403 from the guard,
 * 403 for a role outside admin/staff, R1), takes the restaurant only from the
 * session (R2) and reads the JSON body leniently (a bad body is a 400 from the
 * parser, never a 500).
 */
import { NextRequest, NextResponse } from 'next/server'
import type { StaffBookingResult } from '@/application/booking/staff-booking-shared'
import { NO_STORE } from './staff-access'

export async function readJson(request: NextRequest | Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}

const CONFLICT = { status: 409, headers: NO_STORE }

/**
 * 200 {booking, message, paymentUrl?}; 400 {fields} (invalid | phone_required); 404; 409 booking_off | rules |
 * open_change | changed; BOOK-014 W4: 503 payment_unavailable (the provider failed at create, nothing saved, R54).
 */
export function staffBookingResponse(result: StaffBookingResult, created = false): NextResponse {
  if (result.ok) {
    const body = { booking: result.booking, message: result.message, ...(result.paymentUrl ? { paymentUrl: result.paymentUrl } : {}) }
    return NextResponse.json(body, { status: created ? 201 : 200, headers: NO_STORE })
  }
  switch (result.reason) {
    case 'payment_unavailable':
      return NextResponse.json({ error: 'payment_unavailable' }, { status: 503, headers: NO_STORE })
    case 'invalid':
      return NextResponse.json({ error: 'invalid', fields: result.errors }, { status: 400, headers: NO_STORE })
    case 'phone_required':
      return NextResponse.json({ error: 'phone_required', fields: { phone: 'required' } }, { status: 400, headers: NO_STORE })
    case 'not_found':
      return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE })
    case 'rules':
      return NextResponse.json({ error: 'rules', rules: result.rules }, CONFLICT)
    case 'changed':
      return NextResponse.json({ error: 'changed', status: result.status }, CONFLICT)
    default:
      return NextResponse.json({ error: result.reason }, CONFLICT)
  }
}

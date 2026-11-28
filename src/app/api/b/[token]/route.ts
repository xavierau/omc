/**
 * BOOK-001: public submit endpoint for the booking page (spec AC-10/11).
 *
 * Unauthenticated by necessity: the diner is a WhatsApp user. The token in
 * the path is the whole authorisation; restaurant and phone come only from
 * its row (R2). Query parameters are never read.
 *
 * BOOK-014 W3: a deposit hold answers 200 {ok, redirect} (the /p link, built
 * server side); a provider failure answers 503 with the fixed code only (R64).
 */
import { NextRequest, NextResponse } from 'next/server'
import { submitBookingRequest, type SubmitBookingResult } from '@/application/booking/submit-booking-request'
import { submitBookingDeps } from '@/application/booking/booking-deps'
import { extractTrustedClientIp } from '@/application/integration-inbound-guard'
import { applyBookingHeaders } from '@/app/b/booking-security-headers'

const json = (body: unknown, status: number) => applyBookingHeaders(NextResponse.json(body, { status }))

function toResponse(result: SubmitBookingResult): NextResponse {
  if (result.ok) return json('redirect' in result ? { ok: true, redirect: result.redirect } : { ok: true, delivered: result.delivered }, 200)
  switch (result.reason) {
    case 'rate_limited':
      return applyBookingHeaders(NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': '60' } }))
    case 'token_unusable':
      // 410: terminal. The page swaps the form for the recovery link.
      return json({ error: 'token_unusable', state: result.state }, 410)
    case 'booking_unavailable':
      // F11: booking was switched off after the page loaded → the off page.
      return json({ error: 'booking_unavailable', state: 'off' }, 410)
    case 'invalid':
      // BOOK-010 (spec AC-4): a `full` time carries up to 3 times that fit the party.
      return json({ error: 'invalid', fields: result.errors, ...(result.suggestedTimes ? { suggestedTimes: result.suggestedTimes } : {}) }, 400)
    case 'too_many_pending':
      return json({ error: 'too_many_pending' }, 409)
    case 'payment_unavailable':
      return json({ error: 'payment_unavailable' }, 503)
    default:
      return json({ error: 'submission_failed' }, 500)
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }
  const result = await submitBookingRequest(submitBookingDeps(), {
    token,
    body,
    clientIp: extractTrustedClientIp(request),
  })
  return toResponse(result)
}

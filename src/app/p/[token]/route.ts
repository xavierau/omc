/**
 * BOOK-014 (threat R62): GET /p/<token>, the payment link sent to diners (the
 * deposit template's URL button, the agents' payment_url). An open hold
 * answers 303 to the provider's hosted page stored on the deposit (allowed
 * hosts only); anything else answers a neutral page. Never cached, no
 * Referer, not indexed (booking security headers).
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolvePaymentLink } from '@/application/payments/resolve-payment-link'
import { paymentLinkDeps } from '@/application/payments/payment-deps'
import { applyBookingHeaders } from '@/app/b/booking-security-headers'
import { renderPaymentLinkPage } from '../payment-link-page'

export const dynamic = 'force-dynamic'

const returnedFrom = (value: string | null) => (value === 'success' || value === 'cancel' ? value : null)

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  let state
  try {
    state = await resolvePaymentLink(paymentLinkDeps(), { token, returned: returnedFrom(request.nextUrl.searchParams.get('return')) })
  } catch (err) {
    console.error('[Payments] payment link failed:', (err as Error).name)
    state = { kind: 'unavailable' } as const
  }
  if (state.kind === 'redirect') return applyBookingHeaders(NextResponse.redirect(state.url, 303))
  const page = renderPaymentLinkPage(state, token)
  return applyBookingHeaders(
    new NextResponse(page.html, { status: page.status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  )
}

/**
 * BOOK-001: the unified personal booking link `/b/<token>` (spec S3, AC-12).
 *
 * Resolved by the restaurant's CURRENT mode (resolve-booking-link.ts). The
 * external-mode redirect target comes only from stored data: this page never
 * reads its search params (R15). The token is only peeked here.
 */
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { resolveBookingLink } from '@/application/booking/resolve-booking-link'
import { resolveBookingLinkDeps } from '@/application/booking/booking-deps'
import { BookingPageView } from '@/components/booking/booking-page-view'

// Live token state: a cached render would show a form for a used link.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Booking',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default async function BookingLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const view = await resolveBookingLink(resolveBookingLinkDeps(), token)
  if (view.kind === 'redirect') redirect(view.url)
  return <BookingPageView view={view} token={token} />
}

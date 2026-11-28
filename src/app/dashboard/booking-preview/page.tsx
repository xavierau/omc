/**
 * BOOK-009 S1.10: the admin's Preview of the diner booking page with the
 * SAVED settings: no token, a masked phone placeholder, submit disabled.
 * Admin only, like Settings → Booking (BOOK-001 R14); the restaurant comes
 * from the session, never the request.
 */
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { isTenantAdmin } from '@/infrastructure/supabase/guards/require-tenant-admin'
import { previewBookingView } from '@/application/booking/resolve-booking-link'
import { resolveBookingLinkDeps } from '@/application/booking/booking-deps'
import { BookingPageView } from '@/components/booking/booking-page-view'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Booking preview', robots: { index: false, follow: false } }

export default async function BookingPreviewPage() {
  const ctx = await getTenantContext()
  if (!isTenantAdmin(ctx)) notFound()
  const view = await previewBookingView(resolveBookingLinkDeps(), ctx.restaurantId)
  if (view.kind === 'redirect') notFound()
  return <BookingPageView view={view} token="" preview />
}

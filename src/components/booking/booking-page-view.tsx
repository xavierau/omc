/**
 * BOOK-001: the booking page shell: restaurant name and logo, then the form
 * or the unavailable state, then the collection statement (R18). No
 * third-party scripts, fonts or images beyond the restaurant's own logo (R7).
 * BOOK-009: with booking hours, the restaurant info under the name and the
 * slot form (S2); without them, the BOOK-001 form exactly (AC-5). `preview`
 * (S1.10) shows the admin's banner and keeps submit disabled.
 */
import { useTranslations } from 'next-intl'
import { Eye } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { BookingForm } from './booking-form'
import { BookingSlotForm } from './booking-slot-form'
import { BookingUnavailable } from './booking-unavailable'
import { CollectionStatement } from './collection-statement'
import { RestaurantInfo } from './restaurant-info'
import type { BookingLinkView, BookingPageRestaurant } from '@/application/booking/resolve-booking-link'

export type BookingPageViewModel = Exclude<BookingLinkView, { kind: 'redirect' }>
type FormViewModel = Extract<BookingPageViewModel, { kind: 'form' }>

function RestaurantHeader({ restaurant }: { restaurant: BookingPageRestaurant | null }) {
  const t = useTranslations('booking')
  return (
    <CardHeader className="items-center text-center">
      {restaurant?.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={restaurant.logoUrl} alt="" className="mx-auto mb-2 h-16 w-16 rounded-full object-cover" referrerPolicy="no-referrer" />
      ) : null}
      <h1 data-testid="booking-restaurant-name" className="text-xl font-semibold text-balance text-foreground">
        {restaurant?.name || t('genericTitle')}
      </h1>
      <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
    </CardHeader>
  )
}

function PreviewBanner() {
  const t = useTranslations('booking.picker')
  return (
    <p data-testid="booking-preview-banner" role="status" className="flex w-full max-w-md items-center gap-2 rounded-lg bg-pending-soft px-3 py-2 text-sm font-medium text-pending-foreground">
      <Eye className="size-4 shrink-0" aria-hidden />{t('previewBanner')}
    </p>
  )
}

function FormContent({ view, token, preview }: { view: FormViewModel; token: string; preview: boolean }) {
  const shared = { token, maskedPhone: view.maskedPhone, maxPartySize: view.maxPartySize, retryUrl: view.retryUrl, today: view.today, preview }
  if (!view.schedule) return <BookingForm {...shared} />
  return (
    <>
      <RestaurantInfo info={view.schedule.hours.info} />
      <BookingSlotForm {...shared} schedule={view.schedule} />
    </>
  )
}

export function BookingPageView({ view, token, preview = false }: { view: BookingPageViewModel; token: string; preview?: boolean }) {
  // The preview renders inside the dashboard's <main>; only the diner page owns the landmark.
  const Shell = preview ? 'div' : 'main'
  const slots = view.kind === 'form' && Boolean(view.schedule)
  return (
    <Shell className={`flex min-h-screen flex-col items-center gap-3 bg-background px-4 py-8 sm:justify-center ${slots ? 'pb-40' : ''}`}>
      {preview ? <PreviewBanner /> : null}
      <Card className="w-full max-w-md">
        <RestaurantHeader restaurant={view.restaurant} />
        <CardContent className="space-y-6">
          {view.kind === 'form' ? (
            <>
              <FormContent view={view} token={token} preview={preview} />
              <CollectionStatement restaurantName={view.restaurant.name} />
            </>
          ) : (
            <BookingUnavailable reason={view.reason} retryUrl={view.retryUrl} />
          )}
        </CardContent>
      </Card>
    </Shell>
  )
}

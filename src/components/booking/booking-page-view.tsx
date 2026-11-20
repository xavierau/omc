/**
 * BOOK-001: the booking page shell: restaurant name and logo, then the form
 * or the unavailable state, then the collection statement (R18). No
 * third-party scripts, fonts or images beyond the restaurant's own logo (R7).
 */
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { BookingForm } from './booking-form'
import { BookingUnavailable } from './booking-unavailable'
import { CollectionStatement } from './collection-statement'
import type { BookingLinkView, BookingPageRestaurant } from '@/application/booking/resolve-booking-link'

export type BookingPageViewModel = Exclude<BookingLinkView, { kind: 'redirect' }>

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

export function BookingPageView({ view, token }: { view: BookingPageViewModel; token: string }) {
  return (
    <main className="flex min-h-screen flex-col items-center bg-background px-4 py-8 sm:justify-center">
      <Card className="w-full max-w-md">
        <RestaurantHeader restaurant={view.restaurant} />
        <CardContent className="space-y-6">
          {view.kind === 'form' ? (
            <>
              <BookingForm
                token={token}
                maskedPhone={view.maskedPhone}
                today={view.today}
                maxPartySize={view.maxPartySize}
                retryUrl={view.retryUrl}
              />
              <CollectionStatement restaurantName={view.restaurant.name} />
            </>
          ) : (
            <BookingUnavailable reason={view.reason} retryUrl={view.retryUrl} />
          )}
        </CardContent>
      </Card>
    </main>
  )
}

'use client'

/** BOOK-001 AC-13/AC-14: staff handle booking requests (sidebar → Bookings). */
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { BookingList } from '@/components/dashboard/booking-list'
import { useBookingActions, useBookings } from '@/hooks/use-bookings'

export default function BookingsPage() {
  const t = useTranslations('bookings')
  const tc = useTranslations('common')
  const { data, isLoading, error, refetch } = useBookings()
  const { busyId, notice, undelivered, act } = useBookingActions(refetch)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t('heading')}</h1>
        <p className="mt-1 text-muted-foreground">{t('description')}</p>
      </div>
      {error ? (
        <div data-testid="booking-list-error" className="flex flex-col items-center gap-3 py-12">
          <p className="text-muted-foreground">{t('couldntLoad')}</p>
          <Button variant="outline" onClick={refetch}>{tc('retry')}</Button>
        </div>
      ) : isLoading && !data ? (
        <p data-testid="booking-list-loading" className="text-sm text-muted-foreground">{t('loading')}</p>
      ) : (
        <BookingList bookings={data ?? []} busyId={busyId} undelivered={undelivered} notice={notice} onDecide={act} />
      )}
    </div>
  )
}

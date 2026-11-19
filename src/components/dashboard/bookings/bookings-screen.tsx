'use client'

/**
 * BOOK-004: the Bookings page: header (needs-reply pill, view toggle),
 * toolbar (month nav or range; status chips + search), then the Calendar or
 * Table view over the fetched date range. Loading / error + Retry / notices
 * keep their BOOK-001 test ids.
 */
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { BookingNoticeLine } from '@/components/dashboard/booking-list'
import { useBookingActions, useBookings } from '@/hooks/use-bookings'
import { filterBookings, statusCounts } from './booking-groups'
import { BookingsCalendar } from './bookings-calendar'
import { BookingsFilters } from './bookings-filters'
import { BookingsHeader } from './bookings-header'
import { BookingsTable } from './bookings-table'
import { CalendarNav, TableRangeControl } from './bookings-toolbar'
import { useBookingsPage } from './use-bookings-page'

export function BookingsLoading() {
  const t = useTranslations('bookings')
  return <p data-testid="booking-list-loading" className="text-sm text-muted-foreground">{t('loading')}</p>
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('bookings')
  const tc = useTranslations('common')
  return (
    <div data-testid="booking-list-error" className="flex flex-col items-center gap-3 py-12">
      <p className="text-muted-foreground">{t('couldntLoad')}</p>
      <Button variant="outline" onClick={onRetry}>{tc('retry')}</Button>
    </div>
  )
}

export function BookingsScreen() {
  const t = useTranslations('bookings.views')
  const page = useBookingsPage()
  const { data, pendingCount, isLoading, error, refetch } = useBookings(page.range)
  const { busyId, notice, undelivered, act } = useBookingActions(refetch)
  const all = data?.bookings ?? []
  const shown = filterBookings(all, page.status, page.query)
  const actions = { busyId, undelivered, onDecide: act }
  const calendar = page.view === 'calendar'
  const nav = calendar ? (
    <CalendarNav selected={page.selected} isPhone={page.isPhone} onShift={page.shift} onToday={page.goToday} />
  ) : (
    <TableRangeControl range={page.tableRange} onRange={page.setTableRange} />
  )

  return (
    <div className="space-y-5">
      <BookingsHeader view={page.view} pendingCount={pendingCount} onView={page.setView} onShowPending={page.showPending} />
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:justify-between">
        {nav}
        {calendar && page.isPhone ? null : (
          <BookingsFilters
            status={page.status} counts={statusCounts(all)} query={page.query} showSearch
            onStatus={page.setStatus} onQuery={page.setQuery}
          />
        )}
      </div>
      <BookingNoticeLine notice={notice} />
      {data?.truncated ? <p data-testid="bookings-truncated" className="text-sm text-muted-foreground">{t('truncated', { count: all.length })}</p> : null}
      {error ? (
        <LoadError onRetry={refetch} />
      ) : isLoading && !data ? (
        <BookingsLoading />
      ) : calendar ? (
        <BookingsCalendar
          bookings={shown} monthEmpty={all.length === 0} selected={page.selected} today={page.today}
          isPhone={page.isPhone} onSelect={page.select} {...actions}
        />
      ) : (
        <BookingsTable
          bookings={shown} rangeEmpty={all.length === 0} range={page.tableRange} today={page.today}
          isPhone={page.isPhone} onRange={page.setTableRange} {...actions}
        />
      )}
    </div>
  )
}

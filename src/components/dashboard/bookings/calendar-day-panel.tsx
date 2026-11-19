'use client'

/**
 * BOOK-004: the selected day: its date, "N bookings · N guests · N need a
 * reply", and its rows by time (Confirm/Decline on pending ones). An empty
 * month shows the page's empty state here; an empty day says so.
 */
import { useLocale, useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { BookingList, type BookingActionProps } from '@/components/dashboard/booking-list'
import type { BookingItem } from '@/hooks/use-bookings'
import { formatDate } from './booking-dates'
import { daySummary } from './booking-groups'

export interface CalendarDayPanelProps extends BookingActionProps {
  date: string
  bookings: BookingItem[]
  monthEmpty: boolean
  className?: string
}

export function DaySummaryLine({ bookings }: { bookings: BookingItem[] }) {
  const t = useTranslations('bookings.views')
  const s = daySummary(bookings)
  const parts = [t('bookingCount', { count: s.count }), t('guests', { count: s.guests })]
  if (s.pending > 0) parts.push(t('needReply', { count: s.pending }))
  return <span>{parts.join(' · ')}</span>
}

function PanelEmpty({ monthEmpty }: { monthEmpty: boolean }) {
  const t = useTranslations('bookings.views')
  return monthEmpty ? (
    <div data-testid="booking-list-empty" className="px-5 py-10 text-center">
      <p className="font-medium text-foreground">{t('emptyMonthTitle')}</p>
      <p className="mt-1 text-sm text-muted-foreground">{t('emptyMonthDescription')}</p>
    </div>
  ) : (
    <p data-testid="bookings-day-empty" className="px-5 py-10 text-center text-sm text-muted-foreground">
      {t('emptyDay')}
    </p>
  )
}

export function CalendarDayPanel({ date, bookings, monthEmpty, className, ...actions }: CalendarDayPanelProps) {
  const locale = useLocale()
  return (
    <section data-testid="bookings-day-panel" className={cn('overflow-hidden rounded-xl border border-border bg-card', className)}>
      <header className="border-b border-border px-4 py-4 sm:px-5">
        <h2 className="text-lg font-semibold text-foreground">
          {formatDate(date, locale, { weekday: 'long', day: 'numeric', month: 'long' })}
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          <DaySummaryLine bookings={bookings} />
        </p>
      </header>
      {bookings.length === 0 ? <PanelEmpty monthEmpty={monthEmpty} /> : <BookingList bookings={bookings} {...actions} />}
    </section>
  )
}

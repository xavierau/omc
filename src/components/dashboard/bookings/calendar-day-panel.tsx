'use client'

/**
 * BOOK-004: the selected day: its date, "N bookings · N guests · N need a
 * reply", and its rows by time (Confirm/Decline on pending ones). An empty
 * month shows the page's empty state here; an empty day says so; a day whose
 * bookings the filter hid says nothing matches, like the table (review F5).
 * BOOK-010 (S3, AC-10): the Capacity block sits above the rows, and the
 * over-limit prompt below them.
 * BOOK-013 (frame 1): "+ Add" opens the staff form with this date filled in.
 */
import type { ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { BookingList, type BookingActionProps } from '@/components/dashboard/booking-list'
import type { BookingItem } from '@/hooks/use-bookings'
import { formatDate } from './booking-dates'
import { daySummary } from './booking-groups'
import { useStaffBookingActions } from './use-staff-booking'

export interface CalendarDayPanelProps extends BookingActionProps {
  date: string
  bookings: BookingItem[]
  monthEmpty: boolean
  dayHidden?: boolean
  className?: string
  /** BOOK-010: the Capacity block, above the rows. */
  capacity?: ReactNode
  /** BOOK-010: the over-limit prompt, below the rows. */
  footer?: ReactNode
  /** BOOK-014 W4: the day's guests in diners' deposit holds (seats taken, no rows). */
  heldGuests?: number
}

export function DaySummaryLine({ bookings, heldGuests = 0 }: { bookings: BookingItem[]; heldGuests?: number }) {
  const t = useTranslations('bookings.views')
  const s = daySummary(bookings, heldGuests)
  const parts = [t('bookingCount', { count: s.count }), t('guests', { count: s.guests })]
  if (s.pending > 0) parts.push(t('needReply', { count: s.pending }))
  return <span>{parts.join(' · ')}</span>
}

function PanelEmpty({ monthEmpty, dayHidden }: { monthEmpty: boolean; dayHidden: boolean }) {
  const t = useTranslations('bookings.views')
  if (!monthEmpty && dayHidden) {
    return <p data-testid="bookings-no-match" className="px-5 py-10 text-center text-sm text-muted-foreground">{t('noMatch')}</p>
  }
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

export function CalendarDayPanel({ date, bookings, monthEmpty, dayHidden = false, className, capacity, footer, heldGuests = 0, ...actions }: CalendarDayPanelProps) {
  const locale = useLocale()
  const t = useTranslations('bookings.staff')
  const staff = useStaffBookingActions()
  return (
    <section data-testid="bookings-day-panel" className={cn('overflow-hidden rounded-xl border border-border bg-card', className)}>
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground">
            {formatDate(date, locale, { weekday: 'long', day: 'numeric', month: 'long' })}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            <DaySummaryLine bookings={bookings} heldGuests={heldGuests} />
          </p>
        </div>
        <Button variant="outline" onClick={() => staff.openNew(date)} data-testid="booking-day-new-button" className="h-9 shrink-0">
          <Plus aria-hidden />
          {t('add')}
        </Button>
      </header>
      {capacity}
      {bookings.length === 0 ? <PanelEmpty monthEmpty={monthEmpty} dayHidden={dayHidden} /> : <BookingList bookings={bookings} {...actions} />}
      {footer}
    </section>
  )
}

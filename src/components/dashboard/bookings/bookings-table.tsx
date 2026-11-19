'use client'

/**
 * BOOK-004: the Table view: Upcoming (today onward, soonest first) or Past
 * (90 days, newest first), grouped by day; a desktop table or phone cards,
 * never both. Footer: how many are shown, and the Upcoming/Past switch.
 */
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import type { BookingActionProps } from '@/components/dashboard/booking-list'
import type { BookingItem } from '@/hooks/use-bookings'
import { groupByDay } from './booking-groups'
import { tableOrder, type TableRange } from './bookings-view-state'
import { BookingsTableCards } from './bookings-table-cards'
import { BookingsTableDesktop } from './bookings-table-desktop'

export interface BookingsTableProps extends BookingActionProps {
  bookings: BookingItem[]
  rangeEmpty: boolean
  range: TableRange
  today: string
  isPhone: boolean
  onRange: (range: TableRange) => void
}

function TableEmpty({ rangeEmpty, range }: { rangeEmpty: boolean; range: TableRange }) {
  const t = useTranslations('bookings.views')
  if (!rangeEmpty) {
    return <p data-testid="bookings-no-match" className="px-5 py-10 text-center text-sm text-muted-foreground">{t('noMatch')}</p>
  }
  return (
    <div data-testid="booking-list-empty" className="px-5 py-10 text-center">
      <p className="font-medium text-foreground">{t(range === 'upcoming' ? 'emptyUpcomingTitle' : 'emptyPastTitle')}</p>
      <p className="mt-1 text-sm text-muted-foreground">{t('emptyRangeDescription')}</p>
    </div>
  )
}

export function BookingsTable({ bookings, rangeEmpty, range, today, isPhone, onRange, ...actions }: BookingsTableProps) {
  const t = useTranslations('bookings.views')
  const groups = groupByDay(bookings, tableOrder(range))
  const other: TableRange = range === 'upcoming' ? 'past' : 'upcoming'
  const body =
    groups.length === 0 ? (
      <TableEmpty rangeEmpty={rangeEmpty} range={range} />
    ) : isPhone ? (
      <BookingsTableCards groups={groups} today={today} {...actions} />
    ) : (
      <BookingsTableDesktop groups={groups} today={today} {...actions} />
    )
  return (
    <div data-testid="bookings-table" className={isPhone ? 'space-y-4' : 'overflow-hidden rounded-xl border border-border bg-card'}>
      {body}
      <div className={isPhone ? 'flex flex-col items-start gap-2' : 'flex items-center justify-between gap-3 border-t border-border px-4 py-3'}>
        <p className="text-sm text-muted-foreground">{t(range === 'upcoming' ? 'showingUpcoming' : 'showingPast', { count: bookings.length })}</p>
        <Button variant="outline" size="sm" onClick={() => onRange(other)}>
          {t(other === 'past' ? 'showPast' : 'showUpcoming')}
        </Button>
      </div>
    </div>
  )
}

'use client'

/** BOOK-004: the phone Table view: day groups of booking cards, full-width Confirm/Decline. */
import { useTranslations } from 'next-intl'
import { BookingNotes, BookingStatusBadge, NotDeliveredBadge, PhoneLink, RowActions } from '@/components/dashboard/booking-row'
import type { BookingActionProps } from '@/components/dashboard/booking-list'
import type { BookingItem } from '@/hooks/use-bookings'
import { cn } from '@/lib/utils'
import { BookingSource } from './booking-source'
import { DayHeading } from './booking-day-heading'
import type { BookingGroupsProps } from './bookings-table-desktop'

function BookingCard({ booking, busyId, undelivered, onDecide }: BookingActionProps & { booking: BookingItem }) {
  const t = useTranslations('bookings')
  return (
    <li
      data-testid={`booking-row-${booking.id}`}
      className={cn('flex flex-col gap-2 rounded-xl border border-border bg-card p-4', booking.status === 'pending' && 'border-accent/40 bg-pending-soft')}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-base font-semibold break-words text-foreground">
          <span className="mr-2 tabular-nums">{booking.bookingTime}</span>
          {booking.name ?? t('nameRemoved')}
        </p>
        <BookingStatusBadge booking={booking} />
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <span>{t('pax', { count: booking.partySize })}</span>
        <PhoneLink phone={booking.phone} />
        <span data-testid={booking.source === 'agent' ? `booking-row-${booking.id}-via-agent` : undefined}>
          <BookingSource source={booking.source} />
        </span>
      </p>
      <BookingNotes booking={booking} />
      <NotDeliveredBadge booking={booking} undelivered={undelivered.has(booking.id)} />
      <div className="pt-1 empty:hidden">
        <RowActions booking={booking} busy={busyId === booking.id} onDecide={onDecide} stretch />
      </div>
    </li>
  )
}

export function BookingsTableCards({ groups, today, ...actions }: BookingGroupsProps) {
  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <section key={group.date} className="space-y-2">
          <h3><DayHeading group={group} today={today} /></h3>
          <ul className="space-y-3">
            {group.bookings.map((b) => (
              <BookingCard key={b.id} booking={b} {...actions} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

'use client'

/**
 * BOOK-004: the phone Table view: day groups of booking cards, full-width Confirm/Decline. BOOK-007: full-width Mark no-show / Undo.
 * BOOK-008: the name opens the linked member; the member link control sits under the party/phone line.
 * BOOK-013: the ⋯ menu by the status, "By staff · name", full-width Arrived / Undo.
 */
import { useTranslations } from 'next-intl'
import {
  BookingNotes,
  BookingStatusBadge,
  CancelledByBadge,
  cancelledText,
  ChangeFromLine,
  ChangePendingLine,
  NotDeliveredBadge,
  PhoneLink,
  RowActions,
  TermsAccepted,
} from '@/components/dashboard/booking-row'
import type { BookingActionProps } from '@/components/dashboard/booking-list'
import type { BookingItem } from '@/hooks/use-bookings'
import { cn } from '@/lib/utils'
import { NoShowAction } from './booking-no-show-action'
import { BookingGuestName, MemberLinkControl } from './booking-member'
import { BookingSource } from './booking-source'
import { DayHeading } from './booking-day-heading'
import { ArrivedAction, BookingRowMenu, CheckInRefusedLine, StaffSourceBadge } from './booking-staff-controls'
import type { BookingGroupsProps } from './bookings-table-desktop'

function BookingCard({ booking, busyIds, undelivered, onDecide, onNoShow }: BookingActionProps & { booking: BookingItem }) {
  const t = useTranslations('bookings')
  return (
    <li
      data-testid={`booking-row-${booking.id}`}
      className={cn('flex flex-col gap-2 rounded-xl border border-border bg-card p-4', booking.status === 'pending' && 'border-accent/40 bg-pending-soft')}
    >
      <div className="flex items-start justify-between gap-2">
        <p className={cn('min-w-0 text-base font-semibold break-words text-foreground', cancelledText(booking))}>
          <span className="mr-2 tabular-nums">{booking.bookingTime}</span>
          <BookingGuestName booking={booking} />
        </p>
        <span className="flex shrink-0 items-center gap-1">
          <BookingStatusBadge booking={booking} />
          <BookingRowMenu booking={booking} />
        </span>
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <span>{t('pax', { count: booking.partySize })}</span>
        <PhoneLink phone={booking.phone} />
        <span data-testid={booking.source === 'agent' ? `booking-row-${booking.id}-via-agent` : undefined}>
          {booking.source === 'staff' ? <StaffSourceBadge booking={booking} /> : <BookingSource source={booking.source} />}
        </span>
      </p>
      <MemberLinkControl booking={booking} />
      <div className="flex empty:hidden">
        <CancelledByBadge booking={booking} />
      </div>
      <ChangeFromLine booking={booking} />
      <ChangePendingLine booking={booking} />
      <BookingNotes booking={booking} />
      <TermsAccepted booking={booking} />
      <NotDeliveredBadge booking={booking} undelivered={undelivered.has(booking.id)} />
      <CheckInRefusedLine booking={booking} />
      <div className="pt-1 empty:hidden">
        <RowActions booking={booking} busy={busyIds.has(booking.id)} onDecide={onDecide} stretch />
        <NoShowAction booking={booking} busy={busyIds.has(booking.id)} onNoShow={onNoShow} stretch />
        <ArrivedAction booking={booking} stretch />
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

'use client'

/**
 * BOOK-004: the desktop Table view: one shadcn table, day group header rows,
 * then one row per booking. Pending rows are tinted and carry Confirm/Decline.
 * AGENT-003: the cancelled-by badge sits by the status, the change-from line in
 * the notes; a cancelled booking's time and guest are struck through.
 * BOOK-006: the change-pending marker sits in the notes too, in place of the actions.
 * BOOK-007: past confirmed rows offer "Mark no-show"; no-show rows "Undo".
 * BOOK-008: the guest cell's name opens the linked member; the member link control sits under it.
 * BOOK-013: the source cell says "By staff · name"; the phone cell carries the check-in code; the
 * actions cell Arrived / Undo and the ⋯ menu (Edit / Cancel).
 */
import { useTranslations } from 'next-intl'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
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
import { ArrivedAction, BookingRowMenu, CheckInRefusedLine, CheckinCode, StaffSourceBadge } from './booking-staff-controls'
import type { DayGroup } from './booking-groups'

export interface BookingGroupsProps extends BookingActionProps {
  groups: DayGroup[]
  today: string
}

function BookingTableRow({ booking, busyIds, undelivered, onDecide, onNoShow }: BookingActionProps & { booking: BookingItem }) {
  const t = useTranslations('bookings')
  return (
    <TableRow data-testid={`booking-row-${booking.id}`} className={cn(booking.status === 'pending' && 'bg-pending-soft hover:bg-pending-soft')}>
      <TableCell className={cn('text-base font-semibold tabular-nums', cancelledText(booking))}>{booking.bookingTime}</TableCell>
      <TableCell className="whitespace-normal">
        <BookingGuestName booking={booking} className={cn('font-medium', cancelledText(booking))} />
        <MemberLinkControl booking={booking} />
      </TableCell>
      <TableCell className="text-muted-foreground">
        <PhoneLink phone={booking.phone} />
        <CheckinCode booking={booking} className="block" />
      </TableCell>
      <TableCell className="tabular-nums">{booking.partySize}</TableCell>
      <TableCell>
        <span className="flex flex-wrap items-center gap-1.5">
          <BookingStatusBadge booking={booking} />
          <CancelledByBadge booking={booking} />
          <NotDeliveredBadge booking={booking} undelivered={undelivered.has(booking.id)} short />
        </span>
      </TableCell>
      {/* The Source column says "AI agent"; it carries the BOOK-003 via-agent test id instead of a second badge. */}
      <TableCell data-testid={booking.source === 'agent' ? `booking-row-${booking.id}-via-agent` : undefined}>
        {booking.source === 'staff' ? <StaffSourceBadge booking={booking} /> : <BookingSource source={booking.source} />}
      </TableCell>
      <TableCell className="max-w-56 whitespace-pre-wrap text-muted-foreground">
        <ChangeFromLine booking={booking} />
        <ChangePendingLine booking={booking} />
        {booking.notes ?? (booking.declineReason || booking.replacesBookingId || booking.openChange ? null : '—')}
        {booking.status === 'declined' && booking.declineReason ? (
          <span className="block text-xs">{t('declinedBecause', { reason: booking.declineReason })}</span>
        ) : null}
        <TermsAccepted booking={booking} />
      </TableCell>
      <TableCell className="text-right">
        <span className="inline-flex items-center justify-end gap-1">
          <RowActions booking={booking} busy={busyIds.has(booking.id)} onDecide={onDecide} />
          <NoShowAction booking={booking} busy={busyIds.has(booking.id)} onNoShow={onNoShow} />
          <ArrivedAction booking={booking} />
          <BookingRowMenu booking={booking} />
        </span>
        <CheckInRefusedLine booking={booking} />
      </TableCell>
    </TableRow>
  )
}

export function BookingsTableDesktop({ groups, today, ...actions }: BookingGroupsProps) {
  const t = useTranslations('bookings.views.columns')
  const heads = ['time', 'guest', 'phone', 'party', 'status', 'source', 'notes'] as const
  return (
    <Table className="min-w-[56rem] [&_td]:px-3">
      <TableHeader className="bg-muted/50">
        <TableRow className="hover:bg-transparent">
          {heads.map((h) => (
            <TableHead key={h} className="px-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">{t(h)}</TableHead>
          ))}
          <TableHead className="px-3"><span className="sr-only">{t('actions')}</span></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {groups.map((group) => [
          <TableRow key={group.date} className="bg-muted/30 hover:bg-muted/30">
            <TableCell colSpan={8} className="px-3 py-2"><DayHeading group={group} today={today} /></TableCell>
          </TableRow>,
          ...group.bookings.map((b) => <BookingTableRow key={b.id} booking={b} {...actions} />),
        ])}
      </TableBody>
    </Table>
  )
}

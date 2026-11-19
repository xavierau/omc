'use client'

/**
 * BOOK-004: the desktop Table view: one shadcn table, day group header rows,
 * then one row per booking. Pending rows are tinted and carry Confirm/Decline.
 */
import { useTranslations } from 'next-intl'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { BookingStatusBadge, NotDeliveredBadge, PhoneLink, RowActions } from '@/components/dashboard/booking-row'
import type { BookingActionProps } from '@/components/dashboard/booking-list'
import type { BookingItem } from '@/hooks/use-bookings'
import { cn } from '@/lib/utils'
import { BookingSource } from './booking-source'
import { DayHeading } from './booking-day-heading'
import type { DayGroup } from './booking-groups'

export interface BookingGroupsProps extends BookingActionProps {
  groups: DayGroup[]
  today: string
}

function BookingTableRow({ booking, busyId, undelivered, onDecide }: BookingActionProps & { booking: BookingItem }) {
  const t = useTranslations('bookings')
  return (
    <TableRow data-testid={`booking-row-${booking.id}`} className={cn(booking.status === 'pending' && 'bg-pending-soft hover:bg-pending-soft')}>
      <TableCell className="text-base font-semibold tabular-nums">{booking.bookingTime}</TableCell>
      <TableCell className="font-medium whitespace-normal">{booking.name ?? t('nameRemoved')}</TableCell>
      <TableCell className="text-muted-foreground"><PhoneLink phone={booking.phone} /></TableCell>
      <TableCell className="tabular-nums">{booking.partySize}</TableCell>
      <TableCell>
        <span className="flex items-center gap-1.5">
          <BookingStatusBadge booking={booking} />
          <NotDeliveredBadge booking={booking} undelivered={undelivered.has(booking.id)} short />
        </span>
      </TableCell>
      {/* The Source column says "AI agent"; it carries the BOOK-003 via-agent test id instead of a second badge. */}
      <TableCell data-testid={booking.source === 'agent' ? `booking-row-${booking.id}-via-agent` : undefined}>
        <BookingSource source={booking.source} />
      </TableCell>
      <TableCell className="max-w-56 whitespace-pre-wrap text-muted-foreground">
        {booking.notes ?? (booking.declineReason ? null : '—')}
        {booking.status === 'declined' && booking.declineReason ? (
          <span className="block text-xs">{t('declinedBecause', { reason: booking.declineReason })}</span>
        ) : null}
      </TableCell>
      <TableCell className="text-right">
        <span className="inline-flex justify-end">
          <RowActions booking={booking} busy={busyId === booking.id} onDecide={onDecide} />
        </span>
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

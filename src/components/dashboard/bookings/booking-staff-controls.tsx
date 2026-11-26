'use client'

/**
 * BOOK-013 (mockup frames 1, 7): what each booking row adds. The ⋯ menu with
 * Edit booking (pending/confirmed, no open change: AC-10) and Cancel booking
 * (confirmed only; pending keeps Decline); the "By staff · Mandy" source
 * badge; the check-in code; Arrived on today's confirmed bookings and
 * "Arrived 19:04 · Undo" once checked in (R14). The actions come from
 * StaffBookingContext, so every view offers the same ones.
 */
import { useTranslations } from 'next-intl'
import { DropdownMenu } from 'radix-ui'
import { Check, MoreHorizontal, Pencil, UserRound, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { BookingItem } from '@/hooks/use-bookings'
import { canCheckIn } from '@/domain/services/booking-checkin'
import { canCancelBooking, canEditBooking } from './staff-booking-api'
import { useStaffBookingActions } from './use-staff-booking'
import { hkClock } from './use-booking-capacity'
import { todayInHongKong } from './booking-dates'

export function StaffSourceBadge({ booking }: { booking: BookingItem }) {
  const t = useTranslations('bookings.staff')
  if (booking.source !== 'staff') return null
  return (
    <Badge variant="outline" className="text-muted-foreground" data-testid={`booking-row-${booking.id}-by-staff`}>
      <UserRound aria-hidden />
      {booking.createdByName ? t('byStaffName', { name: booking.createdByName }) : t('byStaff')}
    </Badge>
  )
}

/** R10: the code is the diner's check-in key, shown so staff can match a code read aloud. */
export function CheckinCode({ booking, className }: { booking: BookingItem; className?: string }) {
  if (!booking.checkinCode || (booking.status !== 'confirmed' && booking.status !== 'no_show')) return null
  return (
    <span data-testid={`booking-row-${booking.id}-code`} className={cn('font-mono text-xs tracking-wider text-muted-foreground tabular-nums', className)}>
      {booking.checkinCode}
    </span>
  )
}

const ITEM = 'flex min-h-10 cursor-pointer select-none items-center gap-2 rounded-md px-3 text-sm outline-none data-[highlighted]:bg-muted'

export function BookingRowMenu({ booking }: { booking: BookingItem }) {
  const t = useTranslations('bookings.staff')
  const staff = useStaffBookingActions()
  const edit = canEditBooking(booking)
  const cancel = canCancelBooking(booking)
  if (!edit && !cancel) return null
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" size="icon-lg" aria-label={t('menu')} data-testid={`booking-row-${booking.id}-menu`} className="shrink-0">
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className="z-50 min-w-44 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg">
          {edit ? (
            <DropdownMenu.Item className={ITEM} onSelect={() => staff.openEdit(booking)} data-testid={`booking-row-${booking.id}-edit`}>
              <Pencil aria-hidden className="size-4" />
              {t('edit')}
            </DropdownMenu.Item>
          ) : null}
          {cancel ? (
            <DropdownMenu.Item className={cn(ITEM, 'text-destructive')} onSelect={() => staff.openCancel(booking)} data-testid={`booking-row-${booking.id}-cancel`}>
              <X aria-hidden className="size-4" />
              {t('cancelBooking')}
            </DropdownMenu.Item>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

/** R14: Arrived on today's confirmed booking; once arrived, the time and Undo. */
export function ArrivedAction({ booking, stretch = false }: { booking: BookingItem; stretch?: boolean }) {
  const t = useTranslations('bookings.today')
  const staff = useStaffBookingActions()
  const busy = staff.checkInBusy.has(booking.id)
  if (booking.checkedInAt) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="inline-flex items-center gap-1 text-sm font-medium text-primary" data-testid={`booking-row-${booking.id}-arrived-at`}>
          <Check aria-hidden className="size-4" />
          {t('stateArrived', { time: hkClock(booking.checkedInAt) })}
        </span>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void staff.checkIn(booking.id, 'undo')} data-testid={`booking-row-${booking.id}-arrived-undo`}>
          {t('undo')}
        </Button>
      </span>
    )
  }
  if (!canCheckIn(booking, todayInHongKong())) return null
  return (
    <Button
      size={stretch ? 'lg' : 'sm'} disabled={busy} onClick={() => void staff.checkIn(booking.id, 'arrive')}
      data-testid={`booking-row-${booking.id}-arrived`} className={cn(stretch && 'w-full')}
    >
      <Check aria-hidden />
      {t('arrived')}
    </Button>
  )
}

/** "This booking changed. Reload and try again." under a row whose Arrived was refused. */
export function CheckInRefusedLine({ booking }: { booking: BookingItem }) {
  const t = useTranslations('bookings.today')
  const staff = useStaffBookingActions()
  if (staff.checkInRefused !== booking.id) return null
  return <p role="status" className="text-sm text-destructive" data-testid={`booking-row-${booking.id}-arrived-refused`}>{t('arrivedFailed')}</p>
}

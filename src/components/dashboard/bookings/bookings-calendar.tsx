'use client'

/**
 * BOOK-004: the Calendar view. Desktop: month grid + 360px day panel (the
 * panel drops below the grid under 1024px). Phone: week strip + day list.
 * Only one layout renders, so each booking row exists once.
 */
import type { BookingActionProps } from '@/components/dashboard/booking-list'
import type { BookingItem } from '@/hooks/use-bookings'
import { bookingsOn } from './booking-groups'
import { CalendarDayPanel } from './calendar-day-panel'
import { CalendarMonthGrid } from './calendar-month-grid'
import { CalendarWeekStrip } from './calendar-week-strip'

export interface BookingsCalendarProps extends BookingActionProps {
  bookings: BookingItem[]
  monthEmpty: boolean
  /** The selected day has bookings the filter hid: its panel says nothing matches. */
  dayHidden?: boolean
  selected: string
  today: string
  isPhone: boolean
  onSelect: (date: string) => void
}

export function BookingsCalendar({ bookings, monthEmpty, dayHidden = false, selected, today, isPhone, onSelect, ...actions }: BookingsCalendarProps) {
  const days = { bookings, selected, today, onSelect }
  const panel = { date: selected, bookings: bookingsOn(bookings, selected), monthEmpty, dayHidden, ...actions }
  if (isPhone) {
    return (
      <div className="space-y-4">
        <CalendarWeekStrip {...days} />
        <CalendarDayPanel {...panel} />
      </div>
    )
  }
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <CalendarMonthGrid {...days} />
      <CalendarDayPanel {...panel} className="lg:self-stretch" />
    </div>
  )
}

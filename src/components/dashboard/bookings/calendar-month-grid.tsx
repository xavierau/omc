'use client'

/**
 * BOOK-004: the desktop month grid. Weeks start Sunday; days of other months
 * are greyed; each day shows its guests (declined and cancelled left out), up to three
 * chips by time coloured by status, then "+N more". Clicking selects the day.
 */
import { useLocale, useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import type { BookingItem } from '@/hooks/use-bookings'
import { addDays, formatDate, monthGrid, monthKey } from './booking-dates'
import { bookingsOn, chipName, covers } from './booking-groups'

const MAX_CHIPS = 3

const CHIP_TONE: Record<BookingItem['status'], string> = {
  unverified: 'bg-muted text-muted-foreground',
  pending: 'bg-pending-soft text-pending-foreground ring-1 ring-accent/30',
  confirmed: 'bg-primary/10 text-primary',
  declined: 'bg-muted text-muted-foreground line-through',
  cancelled: 'bg-muted text-muted-foreground line-through',
}

const DOT_TONE: Record<BookingItem['status'], string> = {
  unverified: 'bg-muted-foreground',
  pending: 'bg-accent',
  confirmed: 'bg-primary',
  declined: 'bg-muted-foreground',
  cancelled: 'bg-muted-foreground',
}

export interface CalendarDaysProps {
  bookings: BookingItem[]
  selected: string
  today: string
  onSelect: (date: string) => void
}

function DayChips({ bookings }: { bookings: BookingItem[] }) {
  const t = useTranslations('bookings.views')
  const extra = bookings.length - MAX_CHIPS
  return (
    <div className="mt-1.5 flex flex-col gap-1">
      {bookings.slice(0, MAX_CHIPS).map((b) => (
        <span key={b.id} title={`${b.bookingTime} ${b.name ?? ''}`} className={cn('flex min-w-0 items-center gap-1 rounded-sm px-1 py-0.5 text-xs', CHIP_TONE[b.status])}>
          <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', DOT_TONE[b.status])} />
          <span className="tabular-nums">{b.bookingTime}</span>
          <span className="truncate">{chipName(b.name)}</span>
        </span>
      ))}
      {extra > 0 ? <span className="px-1.5 text-xs text-muted-foreground">{t('more', { count: extra })}</span> : null}
    </div>
  )
}

function DayCell({ date, inMonth, props }: { date: string; inMonth: boolean; props: CalendarDaysProps }) {
  const t = useTranslations('bookings.views')
  const locale = useLocale()
  const day = bookingsOn(props.bookings, date)
  const guests = covers(day)
  const isToday = date === props.today
  return (
    <button
      type="button"
      onClick={() => props.onSelect(date)}
      aria-pressed={date === props.selected}
      aria-label={formatDate(date, locale, { weekday: 'long', day: 'numeric', month: 'long' })}
      data-testid={`bookings-calendar-day-${date}`}
      className={cn(
        'flex min-h-28 min-w-0 cursor-pointer flex-col justify-start border-r border-b border-border p-1.5 text-left transition-colors hover:bg-muted/50 focus-visible:relative focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-ring [&:nth-child(7n)]:border-r-0',
        !inMonth && 'bg-muted/30',
        date === props.selected && 'relative z-[1] ring-2 ring-primary ring-inset'
      )}
    >
      <span className="flex items-center justify-between gap-1">
        <span
          className={cn(
            'grid size-6 place-items-center rounded-full text-sm tabular-nums',
            isToday ? 'bg-primary font-semibold text-primary-foreground' : inMonth ? 'text-foreground' : 'text-muted-foreground/60'
          )}
        >
          {Number(date.slice(8))}
        </span>
        {guests > 0 ? <span className="truncate text-xs text-muted-foreground">{t('guests', { count: guests })}</span> : null}
      </span>
      {day.length > 0 ? <DayChips bookings={day} /> : null}
    </button>
  )
}

export function CalendarMonthGrid(props: CalendarDaysProps) {
  const locale = useLocale()
  const weeks = monthGrid(props.selected)
  const month = monthKey(props.selected)
  return (
    <div data-testid="bookings-calendar" className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="grid grid-cols-7 border-b border-border bg-muted/50 text-xs font-medium text-muted-foreground">
        {weeks[0].map((d, i) => (
          <span key={d} className="px-2 py-2">
            {formatDate(addDays(weeks[0][0], i), locale, { weekday: 'short' })}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 [&>*:nth-last-child(-n+7)]:border-b-0">
        {weeks.flat().map((date) => (
          <DayCell key={date} date={date} inMonth={monthKey(date) === month} props={props} />
        ))}
      </div>
    </div>
  )
}

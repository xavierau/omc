'use client'

/**
 * BOOK-004: the phone calendar: the 7 days (Sun..Sat) of the selected day's
 * week. The selected day is filled; a dot marks days with bookings, amber
 * when any still needs a reply, primary when all are decided.
 */
import { useLocale } from 'next-intl'
import { cn } from '@/lib/utils'
import { formatDate, weekOf } from './booking-dates'
import { bookingsOn } from './booking-groups'
import type { CalendarDaysProps } from './calendar-month-grid'

function dotTone(statuses: string[]): string | null {
  if (statuses.length === 0) return null
  return statuses.includes('pending') ? 'bg-accent' : 'bg-primary'
}

export function CalendarWeekStrip(props: CalendarDaysProps) {
  const locale = useLocale()
  return (
    <div data-testid="bookings-calendar" className="grid grid-cols-7 gap-1 rounded-xl border border-border bg-card p-1.5">
      {weekOf(props.selected).map((date) => {
        const selected = date === props.selected
        const dot = dotTone(bookingsOn(props.bookings, date).map((b) => b.status))
        return (
          <button
            key={date}
            type="button"
            onClick={() => props.onSelect(date)}
            aria-pressed={selected}
            aria-label={formatDate(date, locale, { weekday: 'long', day: 'numeric', month: 'long' })}
            data-testid={`bookings-calendar-day-${date}`}
            className={cn(
              'flex min-h-16 cursor-pointer flex-col items-center gap-0.5 rounded-lg py-1.5 text-center focus-visible:outline-2 focus-visible:outline-ring',
              selected ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
            )}
          >
            <span className={cn('text-xs', selected ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
              {formatDate(date, locale, { weekday: 'short' })}
            </span>
            <span className={cn('text-base tabular-nums', date === props.today && !selected && 'font-semibold text-primary')}>
              {Number(date.slice(8))}
            </span>
            <span aria-hidden className={cn('size-1.5 rounded-full', dot ?? 'invisible', selected && dot === 'bg-primary' && 'bg-primary-foreground')} />
          </button>
        )
      })}
    </div>
  )
}

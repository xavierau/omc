'use client'

/**
 * BOOK-009 AC-6: a month calendar from today to the window's end (prev/next
 * month). Closed days (weekly or special) are greyed and marked 休息; days
 * with no slot left and days outside the window are greyed; none of them can
 * be picked (aria-disabled).
 * BOOK-010 AC-12: with the server's room, an open day where no slot can take
 * the party is greyed and marked 已滿 (data-state="full"), distinct from 休息.
 */
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BookingClock } from '@/domain/services/booking-hours'
import type { BookingHours } from '@/domain/value-objects/booking-hours'
import type { SlotFits } from '@/domain/services/booking-room'
import { dayState, dinerDayState, monthGrid, monthOf, monthsInWindow, type DayState } from './slot-picker-model'
import { chipClass } from './chip'

const HEAD = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

export interface DayCalendarProps {
  hours: BookingHours
  clock: BookingClock
  value: string
  onChange: (date: string) => void
  /** BOOK-010: whether a slot can take the chosen party (absent = BOOK-009 days). */
  fits?: SlotFits
}

const DATA_STATE: Record<DayState, string> = { past: 'past', beyond: 'beyond', closed: 'closed', full: 'full', booked: 'full', open: 'open' }

function cellNote(state: DayState): 'closed' | 'full' | 'noTimes' {
  return state === 'closed' ? 'closed' : state === 'booked' ? 'full' : 'noTimes'
}

function DayCell({ date, state, selected, today, onPick }: { date: string; state: DayState; selected: boolean; today: boolean; onPick: () => void }) {
  const t = useTranslations('booking.picker')
  const day = Number(date.slice(8, 10))
  if (state === 'past' || state === 'beyond') {
    return <span data-testid={`booking-day-${date}`} data-state={state} className="flex h-12 items-center justify-center text-sm text-muted-foreground">{day}</span>
  }
  const open = state === 'open'
  return (
    <button type="button" disabled={!open} aria-disabled={!open} aria-pressed={selected} onClick={onPick} data-testid={`booking-day-${date}`} data-state={DATA_STATE[state]}
      aria-label={open ? undefined : `${day} ${t(cellNote(state))}`}
      className={cn(chipClass(selected), 'h-12 flex-col gap-0 leading-tight', !open && 'border-transparent bg-muted text-muted-foreground')}>
      <span className="text-base">{day}</span>
      {state === 'closed' ? <span className="text-[11px] font-normal">{t('closed')}</span>
        : state === 'booked' ? <span className="text-[11px] font-normal text-pending-foreground">{t('full')}</span>
          : today ? <span className={cn('text-[11px] font-normal', !selected && 'text-primary')}>{t('today')}</span> : null}
    </button>
  )
}

function Legend({ full }: { full: boolean }) {
  const t = useTranslations('booking.picker')
  const swatch = 'inline-block size-3.5 rounded-sm border'
  return (
    <div className="flex gap-4 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5"><span className={cn(swatch, 'border-border bg-card')} />{t('legendOpen')}</span>
      <span className="flex items-center gap-1.5"><span className={cn(swatch, 'border-transparent bg-muted')} />{t('legendClosed')}</span>
      <span className="flex items-center gap-1.5"><span className={cn(swatch, 'border-primary bg-primary')} />{t('legendSelected')}</span>
      {full ? (
        <span data-testid="booking-legend-full" className="flex items-center gap-1.5 text-pending-foreground"><span className={cn(swatch, 'border-transparent bg-muted')} />{t('legendFull')}</span>
      ) : null}
    </div>
  )
}

export function DayCalendar({ hours, clock, value, onChange, fits }: DayCalendarProps) {
  const t = useTranslations('booking.picker')
  const months = monthsInWindow(hours, clock.today)
  const start = value ? months.findIndex((m) => m.year === monthOf(value).year && m.month === monthOf(value).month) : 0
  const [index, setIndex] = useState(Math.max(0, start))
  const month = months[Math.min(index, months.length - 1)]
  const nav = 'inline-flex size-10 items-center justify-center rounded-md text-foreground hover:bg-muted disabled:text-muted-foreground/40 focus-visible:outline-2 focus-visible:outline-ring'
  return (
    <div className="space-y-3">
      <div data-testid="booking-calendar" className="space-y-2 border-y border-border py-2">
        <div className="flex items-center justify-between">
          <button type="button" className={nav} disabled={index === 0} onClick={() => setIndex((i) => i - 1)} aria-label={t('prevMonth')} data-testid="booking-calendar-prev">
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <p className="text-base font-semibold" aria-live="polite">{t('monthTitle', { year: month.year, month: t(`months.${month.month}`) })}</p>
          <button type="button" className={nav} disabled={index >= months.length - 1} onClick={() => setIndex((i) => i + 1)} aria-label={t('nextMonth')} data-testid="booking-calendar-next">
            <ChevronRight className="size-5" aria-hidden />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
          {HEAD.map((d) => <span key={d} className="py-1">{t(`weekdays.${d}`)}</span>)}
        </div>
        {monthGrid(month).map((week, w) => (
          <div key={w} className="grid grid-cols-7 gap-1">
            {week.map((date, i) => date === null ? <span key={i} /> : (
              <DayCell key={date} date={date} state={fits ? dinerDayState(hours, date, clock, fits) : dayState(hours, date, clock)} selected={date === value} today={date === clock.today} onPick={() => onChange(date)} />
            ))}
          </div>
        ))}
      </div>
      <Legend full={Boolean(fits)} />
    </div>
  )
}

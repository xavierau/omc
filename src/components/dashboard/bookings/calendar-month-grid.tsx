'use client'

/**
 * BOOK-004: the desktop month grid. Weeks start Sunday; days of other months
 * are greyed; each day shows its guests (declined, cancelled and no-shows left out), up to three
 * chips by time coloured by status, then "+N more". Clicking selects the day.
 * BOOK-010 (S3, AC-9): a 已滿 Full badge when no slot fits a party of 1, or
 * 已停止 Stopped when staff stopped the whole day.
 */
import { useLocale, useTranslations } from 'next-intl'
import { Wallet } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BookingItem } from '@/hooks/use-bookings'
import { addDays, formatDate, monthGrid, monthKey } from './booking-dates'
import { bookingsOn, chipName, covers } from './booking-groups'
import type { CapacityBadges } from './use-booking-capacity'
import { formatMoney } from '@/domain/value-objects/money'

const MAX_CHIPS = 3

const CHIP_TONE: Record<BookingItem['status'], string> = {
  unverified: 'bg-muted text-muted-foreground',
  pending: 'bg-pending-soft text-pending-foreground ring-1 ring-accent/30',
  confirmed: 'bg-primary/10 text-primary',
  declined: 'bg-muted text-muted-foreground line-through',
  cancelled: 'bg-muted text-muted-foreground line-through',
  no_show: 'bg-muted text-muted-foreground',
  // BOOK-014 W4: a staff booking waiting for its deposit (a lapsed one is never listed).
  awaiting_deposit: 'bg-pending-soft/60 text-pending-foreground ring-1 ring-dashed ring-accent/40',
  lapsed: 'bg-muted text-muted-foreground',
}

const DOT_TONE: Record<BookingItem['status'], string> = {
  unverified: 'bg-muted-foreground',
  pending: 'bg-accent',
  confirmed: 'bg-primary',
  declined: 'bg-muted-foreground',
  cancelled: 'bg-muted-foreground',
  no_show: 'bg-muted-foreground',
  awaiting_deposit: 'bg-accent/60',
  lapsed: 'bg-muted-foreground',
}

export interface CalendarDaysProps {
  bookings: BookingItem[]
  selected: string
  today: string
  onSelect: (date: string) => void
  /** BOOK-010: per-date full / stopped (absent = no badges). */
  badges?: CapacityBadges
  /** BOOK-014 W4 (review finding 9): guests per date in diners' deposit holds, added to the day's guests. */
  holds?: Record<string, number>
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
          {b.deposit ? <DepositChipMark booking={b} /> : null}
        </span>
      ))}
      {extra > 0 ? <span className="px-1.5 text-xs text-muted-foreground">{t('more', { count: extra })}</span> : null}
    </div>
  )
}

/** BOOK-014 W4 (spec AC-14): the chip's deposit state, as an icon with its text for screen readers and on hover. */
function DepositChipMark({ booking }: { booking: BookingItem }) {
  const t = useTranslations('bookings.deposit')
  const d = booking.deposit
  if (!d) return null
  const label = t(`state.${d.status}`, { amount: formatMoney(d.amount) })
  return (
    <span className={cn('ml-auto shrink-0', d.status === 'refund_failed' && 'text-destructive')} title={label} data-testid={`booking-chip-${booking.id}-deposit`} data-state={d.status}>
      <Wallet aria-hidden className="size-3" />
      <span className="sr-only">{label}</span>
    </span>
  )
}

function CapacityBadge({ date, badges }: { date: string; badges?: CapacityBadges }) {
  const t = useTranslations('bookings.capacity')
  const badge = badges?.[date]
  if (!badge || (!badge.full && !badge.stopped)) return null
  const kind = badge.stopped ? 'stopped' : 'full'
  return (
    <span data-testid={`bookings-calendar-day-${date}-full`} data-kind={kind}
      className={cn('shrink-0 rounded-full px-1.5 text-[11px] font-semibold', kind === 'stopped' ? 'bg-destructive/10 text-destructive' : 'bg-pending-soft text-pending-foreground')}>
      {t(kind === 'stopped' ? 'badgeStopped' : 'badgeFull')}
    </span>
  )
}

function DayCell({ date, inMonth, props }: { date: string; inMonth: boolean; props: CalendarDaysProps }) {
  const t = useTranslations('bookings.views')
  const locale = useLocale()
  const day = bookingsOn(props.bookings, date)
  const guests = covers(day) + (props.holds?.[date] ?? 0)
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
        <span className="flex min-w-0 flex-wrap items-center justify-end gap-x-1 gap-y-0.5">
          {guests > 0 ? <span className="truncate text-xs text-muted-foreground">{t('guests', { count: guests })}</span> : null}
          <CapacityBadge date={date} badges={props.badges} />
        </span>
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

'use client'

/** BOOK-004: the left of the toolbar: month navigation (Calendar) or the Upcoming/Past range (Table). */
import { useLocale, useTranslations } from 'next-intl'
import { ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatDate } from './booking-dates'
import type { TableRange } from './bookings-view-state'

export interface CalendarNavProps {
  selected: string
  isPhone: boolean
  onShift: (direction: 1 | -1) => void
  onToday: () => void
}

export function CalendarNav({ selected, isPhone, onShift, onToday }: CalendarNavProps) {
  const t = useTranslations('bookings.views')
  const locale = useLocale()
  const step = isPhone ? 'Week' : 'Month'
  const label = <h2 className="text-lg font-semibold text-foreground">{formatDate(selected, locale, { month: 'long', year: 'numeric' })}</h2>
  const prev = (
    <Button variant="outline" size="icon" onClick={() => onShift(-1)} aria-label={t(`prev${step}`)} data-testid="bookings-calendar-prev">
      <ChevronLeft />
    </Button>
  )
  const next = (
    <Button variant="outline" size="icon" onClick={() => onShift(1)} aria-label={t(`next${step}`)} data-testid="bookings-calendar-next">
      <ChevronRight />
    </Button>
  )
  return (
    <div className="flex w-full items-center gap-2 md:w-auto">
      {prev}
      {isPhone ? <div className="flex-1 text-center">{label}</div> : <>{next}<div className="ml-1">{label}</div></>}
      {isPhone ? next : null}
      <Button variant="outline" onClick={onToday} data-testid="bookings-calendar-today" className={isPhone ? '' : 'ml-2'}>
        {t('today')}
      </Button>
    </div>
  )
}

export function TableRangeControl({ range, onRange }: { range: TableRange; onRange: (range: TableRange) => void }) {
  const t = useTranslations('bookings.views')
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={range}
        onChange={(e) => onRange(e.target.value as TableRange)}
        aria-label={t('rangeLabel')}
        data-testid="bookings-range"
        className="h-8 cursor-pointer rounded-lg border border-border bg-card px-2.5 text-sm font-medium text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <option value="upcoming">{t('upcoming')}</option>
        <option value="past">{t('past')}</option>
      </select>
      <span className="hidden items-center gap-1.5 text-sm text-muted-foreground sm:inline-flex">
        <ArrowUpDown aria-hidden className="size-3.5" />
        {t(range === 'upcoming' ? 'soonestFirst' : 'newestFirst')}
      </span>
    </div>
  )
}

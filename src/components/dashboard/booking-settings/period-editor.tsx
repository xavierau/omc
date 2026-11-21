'use client'

/**
 * BOOK-009 S1.1: a day's (or special date's) periods: optional label, first
 * and last booking time, remove; "+ 加時段" adds one. Edits go up as a new list.
 */
import { useTranslations } from 'next-intl'
import { Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { LATEST_BOOKING_TIME, MAX_PERIODS_PER_DAY, PERIOD_LABEL_MAX_CHARS, type BookingPeriod } from '@/domain/value-objects/booking-hours'
import { addPeriodTo, patchPeriod, removePeriod } from './hours-model'

export interface PeriodsEditorProps {
  periods: BookingPeriod[]
  onChange: (periods: BookingPeriod[]) => void
  /** Test-id stem: `<stem>-period-<i>-first`, `<stem>-add-period`. */
  testId: string
  hasError?: (index: number) => boolean
}

const timeSelect = 'h-8 rounded-md border border-input bg-background px-1.5 text-sm tabular-nums outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50'

/**
 * Booking times as a 24-hour list on the 15-minute grid up to the last
 * booking time (a native time input shows 12-hour text in some locales and
 * clipped "02:00" for 14:00). A stored value off the grid is kept as an option.
 */
const GRID_TIMES = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`)
  .filter((time) => time <= LATEST_BOOKING_TIME)

function TimeSelect({ value, label, testId, onChange }: { value: string; label: string; testId: string; onChange: (v: string) => void }) {
  const options = value === '' || GRID_TIMES.includes(value) ? GRID_TIMES : [...GRID_TIMES, value].sort()
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId} className={timeSelect}>
      {value === '' ? <option value="">--:--</option> : null}
      {options.map((time) => <option key={time} value={time}>{time}</option>)}
    </select>
  )
}

function PeriodChip(props: { period: BookingPeriod; index: number; invalid: boolean; testId: string; onPatch: (p: Partial<BookingPeriod>) => void; onRemove: () => void }) {
  const t = useTranslations('bookingSettings.bookingHours')
  const id = `${props.testId}-period-${props.index}`
  return (
    <div data-testid={id} data-invalid={props.invalid || undefined}
      className={cn('flex flex-wrap items-center gap-1.5 rounded-lg bg-muted px-2 py-1.5', props.invalid && 'bg-destructive/10 ring-1 ring-destructive')}>
      <input aria-label={t('periodLabel')} placeholder={t('periodLabelPlaceholder')} maxLength={PERIOD_LABEL_MAX_CHARS} value={props.period.label ?? ''}
        onChange={(e) => props.onPatch({ label: e.target.value })} data-testid={`${id}-label`}
        className="h-8 w-14 rounded-md bg-transparent px-1 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50" />
      <TimeSelect label={t('first')} value={props.period.first} testId={`${id}-first`} onChange={(first) => props.onPatch({ first })} />
      <span aria-hidden className="text-muted-foreground">→</span>
      <TimeSelect label={t('last')} value={props.period.last} testId={`${id}-last`} onChange={(last) => props.onPatch({ last })} />
      <button type="button" onClick={props.onRemove} aria-label={t('removePeriod')} data-testid={`${id}-remove`}
        className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
        <X className="size-4" aria-hidden />
      </button>
    </div>
  )
}

export function PeriodsEditor({ periods, onChange, testId, hasError }: PeriodsEditorProps) {
  const t = useTranslations('bookingSettings.bookingHours')
  return (
    <div className="flex flex-wrap items-center gap-2">
      {periods.map((p, i) => (
        <PeriodChip key={i} period={p} index={i} invalid={hasError?.(i) ?? false} testId={testId}
          onPatch={(patch) => onChange(patchPeriod(periods, i, patch))} onRemove={() => onChange(removePeriod(periods, i))} />
      ))}
      {periods.length < MAX_PERIODS_PER_DAY ? (
        <button type="button" onClick={() => onChange(addPeriodTo(periods))} data-testid={`${testId}-add-period`}
          className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm font-medium text-primary hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
          <Plus className="size-4" aria-hidden />{t('addPeriod')}
        </button>
      ) : null}
    </div>
  )
}

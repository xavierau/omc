'use client'

/**
 * BOOK-009 S1.1: Mon–Sun rows, each Closed or its periods, with "複製到…".
 * Errors from the save show on the row they belong to (AC-2, A2 mockup).
 */
import { useTranslations } from 'next-intl'
import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Switch } from '@/components/ui/switch'
import { WEEKDAYS, type BookingHours, type Weekday } from '@/domain/value-objects/booking-hours'
import { copyDay, setDay, setDayOpen } from './hours-model'
import { dayError, periodHasError, type SettingsErrors } from './hours-errors'
import { rowErrorText } from './hours-error-text'
import { PeriodsEditor } from './period-editor'
import { CopyDayMenu } from './copy-day-menu'
import { HoursFieldError } from './block'

export interface HoursEditProps {
  hours: BookingHours
  errors: SettingsErrors
  onEdit: (edit: (hours: BookingHours) => BookingHours) => void
}

function DayRow({ day, hours, errors, onEdit }: HoursEditProps & { day: Weekday }) {
  const t = useTranslations('bookingSettings.bookingHours')
  const periods = hours.weekly[day]
  const open = periods.length > 0
  const stem = `booking-settings-hours-${day}`
  const message = rowErrorText(t, dayError(errors, day), periods)
  return (
    <div data-testid={stem} data-open={open} className={cn('space-y-1.5 px-3 py-2.5', message && 'bg-destructive/5')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="w-16 text-sm font-semibold text-foreground">{t(`day.${day}`)}</span>
        <div className="flex w-20 items-center gap-2">
          <Switch checked={open} onCheckedChange={(on) => onEdit((h) => setDayOpen(h, day, on))} aria-label={t('openLabel', { day: t(`day.${day}`) })}
            data-testid={`${stem}-open`} />
          <span className="text-xs text-muted-foreground">{t(open ? 'open' : 'closed')}</span>
        </div>
        <div className="min-w-0 flex-1">
          {open ? (
            <PeriodsEditor periods={periods} onChange={(next) => onEdit((h) => setDay(h, day, next))} testId={stem}
              hasError={(i) => periodHasError(errors, day, i)} />
          ) : (
            <span className="text-xs text-muted-foreground">{t('closedHint')}</span>
          )}
        </div>
        <CopyDayMenu dayLabel={t(`day.${day}`)} testId={stem} onCopy={(target) => onEdit((h) => copyDay(h, day, target))} />
      </div>
      <HoursFieldError message={message} testId={`${stem}-error`} />
    </div>
  )
}

export function WeeklyHoursTable(props: HoursEditProps) {
  const t = useTranslations('bookingSettings.bookingHours')
  return (
    <div className="space-y-2">
      <div className="divide-y divide-border border-y border-border">
        {WEEKDAYS.map((day) => <DayRow key={day} day={day} {...props} />)}
      </div>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Info className="size-3.5" aria-hidden />{t('copyHint')}</p>
    </div>
  )
}

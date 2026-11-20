'use client'

/**
 * BOOK-009 S1.4: special dates, each Closed or its own periods, with an
 * optional label. A special date replaces its weekday (AC-4).
 */
import { useTranslations } from 'next-intl'
import { Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PERIOD_LABEL_MAX_CHARS, type SpecialBookingDate } from '@/domain/value-objects/booking-hours'
import { addSpecial, patchSpecial, removeSpecial, setSpecialOpen } from './hours-model'
import { specialError } from './hours-errors'
import { hoursErrorText } from './hours-error-text'
import { PeriodsEditor } from './period-editor'
import { Segmented } from './segmented'
import { HoursFieldError } from './block'
import type { HoursEditProps } from './weekly-hours-table'

const field = 'h-9 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'

function SpecialRow({ special, index, errors, onEdit }: Omit<HoursEditProps, 'hours'> & { special: SpecialBookingDate; index: number }) {
  const t = useTranslations('bookingSettings.bookingHours')
  const code = specialError(errors, special.date, index)
  const stem = `booking-settings-special-${index}`
  const open = special.periods.length > 0
  return (
    <div data-testid={stem} className={cn('space-y-2 border-b border-border px-1 py-2.5', code && 'bg-destructive/5')}>
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" aria-label={t('specialDate')} value={special.date} data-testid={`${stem}-date`} className={cn(field, 'w-40')}
          onChange={(e) => onEdit((h) => patchSpecial(h, index, { date: e.target.value }))} />
        <input aria-label={t('specialLabel')} placeholder={t('specialLabel')} maxLength={PERIOD_LABEL_MAX_CHARS} value={special.label ?? ''}
          data-testid={`${stem}-label`} className={cn(field, 'w-36')} onChange={(e) => onEdit((h) => patchSpecial(h, index, { label: e.target.value }))} />
        <Segmented label={t('specialKind')} value={open ? 'open' : 'closed'} testId={`${stem}-kind`}
          options={[{ value: 'closed', label: t('specialClosed') }, { value: 'open', label: t('specialOpen') }]}
          onChange={(kind) => onEdit((h) => setSpecialOpen(h, index, kind === 'open'))} />
        <button type="button" aria-label={t('specialRemove')} onClick={() => onEdit((h) => removeSpecial(h, index))} data-testid={`${stem}-remove`}
          className="ml-auto inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:text-destructive focus-visible:outline-2 focus-visible:outline-ring">
          <Trash2 className="size-4" aria-hidden />
        </button>
      </div>
      {open ? (
        <PeriodsEditor periods={special.periods} testId={stem}
          onChange={(periods) => onEdit((h) => patchSpecial(h, index, { periods }))} />
      ) : null}
      <HoursFieldError message={code ? hoursErrorText(t, code, special.periods) : null}
        testId={`booking-settings-special-${special.date || index}-error`} />
    </div>
  )
}

export function SpecialDates({ hours, errors, onEdit }: HoursEditProps) {
  const t = useTranslations('bookingSettings.bookingHours')
  return (
    <div className="space-y-2">
      {hours.special.map((s, i) => <SpecialRow key={i} special={s} index={i} errors={errors} onEdit={onEdit} />)}
      <button type="button" onClick={() => onEdit((h) => addSpecial(h, ''))} data-testid="booking-settings-special-add"
        className="inline-flex h-9 items-center gap-1 rounded-lg border border-primary px-3 text-sm font-medium text-primary hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-ring">
        <Plus className="size-4" aria-hidden />{t('specialAdd')}
      </button>
    </div>
  )
}

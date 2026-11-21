'use client'

/**
 * BOOK-009 S1: the Simple-mode booking blocks, in the spec order: hours,
 * interval and window, special dates, party size and table time, terms,
 * restaurant info, then the rules summary with Preview. Saved with the
 * section's Save; errors come back keyed by path (AC-2).
 * F1 (P2-1): the schedule switch heads the hours block; hours, window and
 * special dates show only while it is on. Party/table time, terms and info
 * always show: they apply with the schedule on or off.
 */
import { useTranslations } from 'next-intl'
import { AlertTriangle } from 'lucide-react'
import { hoursPayload, type BookingSettingsForm } from '@/hooks/use-booking-settings'
import type { BookingHoursSummaryText } from '@/hooks/use-booking-availability'
import type { BookingHours } from '@/domain/value-objects/booking-hours'
import { noBookableTimes } from './hours-model'
import { blockError, type SettingsErrors } from './hours-errors'
import { hoursErrorText } from './hours-error-text'
import { HoursFieldError, SettingsBlock } from './block'
import { WeeklyHoursTable } from './weekly-hours-table'
import { WindowFields } from './window-fields'
import { SpecialDates } from './special-dates'
import { PartyTableFields } from './party-table-fields'
import { InfoFields, TermsFields } from './terms-info-fields'
import { HoursSummaryBox } from './hours-summary-box'
import { ScheduleSwitch } from './schedule-switch'

export interface BookingHoursBlocksProps {
  form: BookingSettingsForm
  errors: SettingsErrors
  onEdit: (edit: (hours: BookingHours) => BookingHours) => void
  onMaxPartySize: (value: string) => void
  summary: BookingHoursSummaryText | null
  dirty: boolean
}

function HoursStatus({ form, errors }: Pick<BookingHoursBlocksProps, 'form' | 'errors'>) {
  const t = useTranslations('bookingSettings.bookingHours')
  const code = blockError(errors)
  const on = form.bookingHours.scheduleEnabled
  // Warn only when this save would switch on hours that offer no time (AC-5: an untouched form stays "not set").
  const warn = on && hoursPayload(form) !== undefined && noBookableTimes(form.bookingHours)
  return (
    <>
      {!on ? <p data-testid="booking-settings-hours-not-set" className="text-xs text-muted-foreground">{t('notConfigured')}</p> : null}
      {warn ? (
        <p data-testid="booking-settings-hours-warning" className="flex items-center gap-1.5 text-xs text-pending-foreground">
          <AlertTriangle className="size-3.5" aria-hidden />{t('noTimesWarning')}
        </p>
      ) : null}
      <HoursFieldError message={code ? hoursErrorText(t, code) : null} testId="booking-settings-hours-error" />
    </>
  )
}

export function BookingHoursBlocks({ form, errors, onEdit, onMaxPartySize, summary, dirty }: BookingHoursBlocksProps) {
  const t = useTranslations('bookingSettings.bookingHours')
  const edit = { hours: form.bookingHours, errors, onEdit }
  const on = form.bookingHours.scheduleEnabled
  return (
    <div className="space-y-5" data-testid="booking-settings-hours">
      <SettingsBlock title={t('title')} hint={on ? t('hint') : undefined}>
        <ScheduleSwitch on={on} onChange={(v) => onEdit((h) => ({ ...h, scheduleEnabled: v }))} />
        <HoursStatus form={form} errors={errors} />
        {on ? <WeeklyHoursTable {...edit} /> : null}
      </SettingsBlock>
      {on ? (
        <>
          <SettingsBlock title={t('windowTitle')}><WindowFields hours={form.bookingHours} onEdit={onEdit} /></SettingsBlock>
          <SettingsBlock title={t('specialTitle')} hint={t('specialHint')}><SpecialDates {...edit} /></SettingsBlock>
        </>
      ) : null}
      <SettingsBlock title={t('partyTitle')}>
        <PartyTableFields hours={form.bookingHours} onEdit={onEdit} maxPartySize={form.maxPartySize} onMaxPartySize={onMaxPartySize}
          maxPartyError={errors.maxPartySize} />
      </SettingsBlock>
      <SettingsBlock title={t('termsTitle')} hint={t('termsHint')}><TermsFields {...edit} /></SettingsBlock>
      <SettingsBlock title={t('infoTitle')} hint={t('infoHint')}><InfoFields {...edit} /></SettingsBlock>
      <HoursSummaryBox summary={summary} dirty={dirty} />
    </div>
  )
}

'use client'

/**
 * BOOK-009 S1: the Simple-mode booking blocks, in the spec order: hours,
 * interval and window, special dates, party size and table time, terms,
 * restaurant info, then the rules summary with Preview. Saved with the
 * section's Save; errors come back keyed by path (AC-2).
 * BOOK-010 S1: 人數上限 Guest limits after party size, while the schedule is in use.
 */
import { useTranslations } from 'next-intl'
import { AlertTriangle } from 'lucide-react'
import { hoursPayload, scheduleInUse, type BookingSettingsForm } from '@/hooks/use-booking-settings'
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
import { GuestLimitFields, type LimitField } from './guest-limit-fields'

export interface BookingHoursBlocksProps {
  form: BookingSettingsForm
  errors: SettingsErrors
  onEdit: (edit: (hours: BookingHours) => BookingHours) => void
  onMaxPartySize: (value: string) => void
  onLimit: (field: LimitField, value: string) => void
  summary: BookingHoursSummaryText | null
  dirty: boolean
}

function HoursStatus({ form, errors }: Pick<BookingHoursBlocksProps, 'form' | 'errors'>) {
  const t = useTranslations('bookingSettings.bookingHours')
  const code = blockError(errors)
  // Warn only when this save would store hours that offer no time (AC-5: an untouched empty table stays "not set").
  const warn = hoursPayload(form) !== undefined && noBookableTimes(form.bookingHours)
  return (
    <>
      {!form.hoursConfigured ? <p data-testid="booking-settings-hours-not-set" className="text-xs text-muted-foreground">{t('notConfigured')}</p> : null}
      {warn ? (
        <p data-testid="booking-settings-hours-warning" className="flex items-center gap-1.5 text-xs text-pending-foreground">
          <AlertTriangle className="size-3.5" aria-hidden />{t('noTimesWarning')}
        </p>
      ) : null}
      <HoursFieldError message={code ? hoursErrorText(t, code) : null} testId="booking-settings-hours-error" />
    </>
  )
}

export function BookingHoursBlocks({ form, errors, onEdit, onMaxPartySize, onLimit, summary, dirty }: BookingHoursBlocksProps) {
  const t = useTranslations('bookingSettings.bookingHours')
  const edit = { hours: form.bookingHours, errors, onEdit }
  return (
    <div className="space-y-5" data-testid="booking-settings-hours">
      <SettingsBlock title={t('title')} hint={t('hint')}>
        <HoursStatus form={form} errors={errors} />
        <WeeklyHoursTable {...edit} />
      </SettingsBlock>
      <SettingsBlock title={t('windowTitle')}><WindowFields hours={form.bookingHours} onEdit={onEdit} /></SettingsBlock>
      <SettingsBlock title={t('specialTitle')} hint={t('specialHint')}><SpecialDates {...edit} /></SettingsBlock>
      <SettingsBlock title={t('partyTitle')}>
        <PartyTableFields hours={form.bookingHours} onEdit={onEdit} maxPartySize={form.maxPartySize} onMaxPartySize={onMaxPartySize}
          maxPartyError={errors.maxPartySize} />
      </SettingsBlock>
      {scheduleInUse(form) ? (
        <SettingsBlock title={t('limits.title')} hint={t('limits.hint')} testId="booking-settings-limits">
          <GuestLimitFields perSlot={form.limitPerSlot} perMeal={form.limitPerMeal} errors={errors} onChange={onLimit} />
        </SettingsBlock>
      ) : null}
      <SettingsBlock title={t('termsTitle')} hint={t('termsHint')}><TermsFields {...edit} /></SettingsBlock>
      <SettingsBlock title={t('infoTitle')} hint={t('infoHint')}><InfoFields {...edit} /></SettingsBlock>
      <HoursSummaryBox summary={summary} dirty={dirty} />
    </div>
  )
}

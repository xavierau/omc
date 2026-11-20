'use client'

/**
 * BOOK-009 S2 (AC-6, AC-7, AC-9): the booking form when the restaurant has
 * booking hours: party buttons, a closed-day calendar, the day's slots, table
 * time, name, notes, terms and a summary bar. The diner's number is shown
 * masked and never sent (BOOK-001 R2, R10); text renders as text (R3).
 */
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
import { termsRequired as hasTerms, type BookingHours } from '@/domain/value-objects/booking-hours'
import { windowEnd } from '@/domain/services/booking-hours'
import { useBookingSlotForm } from '@/hooks/use-booking-slot-form'
import { BookingFormNotice } from './booking-form'
import { BookingUnavailable } from './booking-unavailable'
import { PartyPicker } from './party-picker'
import { DayCalendar } from './day-calendar'
import { SlotList, TableTime } from './slot-list'
import { TermsBlock } from './terms-block'
import { SummaryBar } from './summary-bar'
import { SlotBookingSent } from './slot-booking-sent'
import { SlotTextFields } from './slot-text-fields'
import { dayLabel } from './booking-date-label'

export interface BookingSlotFormProps {
  token: string
  maskedPhone: string
  maxPartySize: number
  retryUrl: string | null
  today: string
  schedule: { hours: BookingHours; nowTime: string }
  preview?: boolean
}

function Heading({ title, aside }: { title: string; aside?: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {aside ? <span className="text-xs text-muted-foreground">{aside}</span> : null}
    </div>
  )
}

function TimesChanged({ time }: { time: string }) {
  const t = useTranslations('booking.picker')
  return (
    <div data-testid="booking-times-changed" role="alert" className="space-y-1 rounded-lg bg-pending-soft p-3 text-sm">
      <p className="flex items-center gap-1.5 font-semibold text-pending-foreground"><AlertTriangle className="size-4" aria-hidden />{t('timesChangedTitle')}</p>
      <p className="text-foreground">{t('timesChangedBody', { time })}</p>
    </div>
  )
}

export function BookingSlotForm({ token, maskedPhone, maxPartySize, retryUrl, today, schedule, preview = false }: BookingSlotFormProps) {
  const t = useTranslations('booking')
  const router = useRouter()
  const { hours } = schedule
  const clock = { today, nowTime: schedule.nowTime }
  const termsRequired = hasTerms(hours)
  const form = useBookingSlotForm({ token, termsRequired, preview, refresh: () => router.refresh() })
  const { values, set, outcome } = form
  const errors = outcome?.kind === 'fields' ? outcome.errors : {}

  if (outcome?.kind === 'sent') return <SlotBookingSent values={values} termsAccepted={termsRequired && values.accepted} />
  if (outcome?.kind === 'gone') return <BookingUnavailable reason={outcome.state} retryUrl={retryUrl} />

  return (
    <form data-testid="booking-form" data-variant="slots" noValidate className="space-y-6" onSubmit={(e) => { e.preventDefault(); void form.submit() }}>
      <p className="text-sm text-muted-foreground">
        {t('phoneLabel')} <span data-testid="booking-masked-phone" className="font-medium text-foreground tabular-nums">{maskedPhone}</span>
      </p>
      <PartyPicker max={maxPartySize} value={values.partySize} onChange={(n) => set('partySize', n)} retryUrl={retryUrl} error={errors.partySize} />
      <section className="space-y-2">
        <Heading title={t('date')} aside={t('picker.bookableUntil', { date: dayLabel(t, windowEnd(hours, today)) })} />
        <DayCalendar hours={hours} clock={clock} value={values.date} onChange={(d) => set('date', d)} />
      </section>
      <section className="space-y-3">
        <Heading title={t('time')} aside={values.date ? dayLabel(t, values.date) : undefined} />
        {form.changedTime ? <TimesChanged time={form.changedTime} /> : null}
        <SlotList hours={hours} clock={clock} date={values.date} value={values.time} onChange={(time) => set('time', time)} />
        <TableTime minutes={hours.tableMinutes} />
      </section>
      <SlotTextFields name={values.name} notes={values.notes} errors={errors} onChange={(k, v) => set(k, v)} />
      {termsRequired ? <TermsBlock terms={hours.terms} accepted={values.accepted} onChange={(a) => set('accepted', a)} error={errors.acceptTerms} /> : null}
      <BookingFormNotice outcome={outcome} />
      <SummaryBar values={values} missing={form.missing} submitting={form.submitting} preview={preview} />
    </form>
  )
}

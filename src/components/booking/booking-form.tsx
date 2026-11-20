'use client'

/**
 * BOOK-001: the booking page form (AC-9..AC-12 UI states). The diner's
 * WhatsApp number is shown masked and never sent: the server takes it from
 * the token (R2, R10). Text is rendered as text only, never as HTML (R3).
 */
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { BookingFormFields } from './booking-form-fields'
import { BookingUnavailable } from './booking-unavailable'
import { postBooking, type BookingFormValues, type BookingSubmitOutcome } from './booking-form-client'

export interface BookingFormProps {
  token: string
  maskedPhone: string
  today: string
  maxPartySize: number
  retryUrl: string | null
}

const EMPTY: BookingFormValues = { date: '', time: '', partySize: '2', name: '', notes: '' }

export function BookingSent() {
  const t = useTranslations('booking')
  return (
    <div data-testid="booking-sent" role="status" className="space-y-2 text-center">
      <h2 className="text-lg font-semibold text-foreground">{t('sentTitle')}</h2>
      <p className="text-sm text-muted-foreground">{t('sentBody')}</p>
    </div>
  )
}

export function BookingFormNotice({ outcome }: { outcome: BookingSubmitOutcome | null }) {
  const t = useTranslations('booking')
  const key = outcome?.kind === 'too_many' ? 'tooManyPending' : outcome?.kind === 'rate_limited' ? 'rateLimited' : outcome?.kind === 'error' ? 'submitFailed' : null
  if (!key) return null
  return (
    <p data-testid="booking-form-error" role="alert" className="text-sm text-destructive">
      {t(key)}
    </p>
  )
}

export function BookingForm({ token, maskedPhone, today, maxPartySize, retryUrl }: BookingFormProps) {
  const t = useTranslations('booking')
  const [values, setValues] = useState<BookingFormValues>(EMPTY)
  const [outcome, setOutcome] = useState<BookingSubmitOutcome | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (outcome?.kind === 'sent') return <BookingSent />
  if (outcome?.kind === 'gone') return <BookingUnavailable reason={outcome.state} retryUrl={retryUrl} />

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setOutcome(await postBooking(token, values))
    setSubmitting(false)
  }

  return (
    <form data-testid="booking-form" onSubmit={submit} noValidate className="space-y-5">
      <p className="text-sm text-muted-foreground">
        {t('phoneLabel')} <span data-testid="booking-masked-phone" className="font-medium text-foreground tabular-nums">{maskedPhone}</span>
      </p>
      <BookingFormFields
        values={values}
        errors={outcome?.kind === 'fields' ? outcome.errors : {}}
        today={today}
        maxPartySize={maxPartySize}
        onChange={(field, value) => setValues((v) => ({ ...v, [field]: value }))}
      />
      <BookingFormNotice outcome={outcome} />
      <Button type="submit" disabled={submitting} className="h-11 w-full" data-testid="booking-submit">
        {submitting ? t('submitting') : t('submit')}
      </Button>
    </form>
  )
}

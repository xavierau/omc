'use client'

/**
 * BOOK-001: the booking page form (AC-9..AC-12 UI states). The diner's
 * WhatsApp number is shown masked and never sent: the server takes it from
 * the token (R2, R10). Text is rendered as text only, never as HTML (R3).
 * BOOK-009 F1 (P2-1): with the schedule switch off, the restaurant's terms
 * (with their required tick) and table time still show here. P3-3: a field
 * error the form has no place for shows in the notice.
 * BOOK-014 W3: with a deposit plan, the deposit line and "Pay deposit HK$X
 * and send" for the chosen party; a hold goes to /p; a 503 shows the
 * payment-unavailable state.
 */
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { BookingFormFields } from './booking-form-fields'
import { BookingUnavailable } from './booking-unavailable'
import { postBooking, type BookingFormValues, type BookingSubmitOutcome } from './booking-form-client'
import { TermsBlock } from './terms-block'
import { TableTime } from './slot-list'
import { DepositLine, DepositRedirect, DepositUnavailable, depositSubmitLabel } from './deposit-line'
import type { DepositPlan } from '@/domain/value-objects/deposit-plan'
import { termsRequired } from '@/domain/value-objects/booking-hours'
import type { BookingPageDetails } from '@/application/booking/resolve-booking-link'

export interface BookingFormProps {
  token: string
  maskedPhone: string
  today: string
  maxPartySize: number
  retryUrl: string | null
  /** BOOK-009 S1.10: the admin Preview; submit stays disabled. */
  preview?: boolean
  /** F1: terms, info and table time when the schedule switch is off (absent = BOOK-001 exactly). */
  details?: BookingPageDetails
  /** BOOK-014 W3: the restaurant's deposit terms; absent = no deposit asked. */
  deposit?: DepositPlan | null
}

const LEGACY_FIELDS = ['date', 'time', 'partySize', 'name', 'notes']

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

/** P3-3: field errors whose field the form does not render (e.g. terms switched on after the page loaded). */
export function unplacedErrors(outcome: BookingSubmitOutcome | null, placed: readonly string[]): string[] {
  if (outcome?.kind !== 'fields') return []
  return Object.entries(outcome.errors).filter(([field]) => !placed.includes(field)).map(([, code]) => code)
}

export function BookingFormNotice({ outcome, placed = [] }: { outcome: BookingSubmitOutcome | null; placed?: readonly string[] }) {
  const t = useTranslations('booking')
  const key = outcome?.kind === 'too_many' ? 'tooManyPending' : outcome?.kind === 'rate_limited' ? 'rateLimited' : outcome?.kind === 'error' ? 'submitFailed' : null
  const unplaced = unplacedErrors(outcome, placed)
  if (!key && unplaced.length === 0) return null
  return (
    <p data-testid="booking-form-error" role="alert" className="text-sm text-destructive">
      {key ? t(key) : unplaced.map((code) => t(`errors.${code}`)).join(' ')}
    </p>
  )
}

/** The typed party size as a whole number, else null (no deposit line while it is not one). */
const partyOf = (raw: string): number | null => (/^\d+$/.test(raw.trim()) ? Number(raw.trim()) : null)

export function BookingForm({ token, maskedPhone, today, maxPartySize, retryUrl, preview = false, details, deposit }: BookingFormProps) {
  const t = useTranslations('booking')
  const [values, setValues] = useState<BookingFormValues>(EMPTY)
  const [accepted, setAccepted] = useState(false)
  const [outcome, setOutcome] = useState<BookingSubmitOutcome | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const terms = termsRequired(details)
  const errors = outcome?.kind === 'fields' ? outcome.errors : {}

  if (outcome?.kind === 'sent') return <BookingSent />
  if (outcome?.kind === 'gone') return <BookingUnavailable reason={outcome.state} retryUrl={retryUrl} />
  if (outcome?.kind === 'redirect') return <DepositRedirect url={outcome.url} />
  if (outcome?.kind === 'payment_unavailable') return <DepositUnavailable retryUrl={retryUrl} />
  const party = partyOf(values.partySize)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (preview) return
    setSubmitting(true)
    setOutcome(await postBooking(token, values, terms ? { acceptTerms: accepted } : {}))
    setSubmitting(false)
  }

  return (
    <form data-testid="booking-form" onSubmit={submit} noValidate className="space-y-5">
      <p className="text-sm text-muted-foreground">
        {t('phoneLabel')} <span data-testid="booking-masked-phone" className="font-medium text-foreground tabular-nums">{maskedPhone}</span>
      </p>
      <BookingFormFields
        values={values}
        errors={errors}
        today={today}
        maxPartySize={maxPartySize}
        onChange={(field, value) => setValues((v) => ({ ...v, [field]: value }))}
      />
      <TableTime minutes={details?.tableMinutes ?? null} />
      {terms && details ? <TermsBlock terms={details.terms} accepted={accepted} onChange={setAccepted} error={errors.acceptTerms} /> : null}
      <BookingFormNotice outcome={outcome} placed={terms ? [...LEGACY_FIELDS, 'acceptTerms'] : LEGACY_FIELDS} />
      <DepositLine plan={deposit} partySize={party} />
      <Button type="submit" disabled={submitting || preview} className="h-11 w-full" data-testid="booking-submit">
        {submitting ? t('submitting') : (depositSubmitLabel(t, deposit, party) ?? t('submit'))}
      </Button>
    </form>
  )
}

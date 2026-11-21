/**
 * BOOK-009 (A2 mockup): an error code from the PUT as the sentence the admin
 * reads, naming the period it is about. Unknown codes read as "check this".
 */
import type { BookingPeriod } from '@/domain/value-objects/booking-hours'
import type { RowError } from './hours-errors'

type Translate = (key: string, values?: Record<string, string | number>) => string

const KNOWN = new Set([
  'invalid_time', 'last_before_first', 'overlap', 'invalid_label', 'label_too_long', 'too_many_periods', 'invalid',
  'past', 'duplicate', 'invalid_date', 'too_many', 'too_long', 'invalid_https_url',
])

export function hoursErrorText(t: Translate, code: string, periods: BookingPeriod[] = [], period: number | null = null): string {
  const key = KNOWN.has(code) ? code : 'invalid'
  const p = period === null ? undefined : periods[period]
  const name = p?.label?.trim() || t('periodFallback', { n: (period ?? 0) + 1 })
  return t(`errors.${key}`, { period: name, first: p?.first ?? '' })
}

export function rowErrorText(t: Translate, error: RowError | null, periods: BookingPeriod[]): string | null {
  return error ? hoursErrorText(t, error.code, periods, error.period) : null
}

/**
 * BOOK-009 (plan D1): a restaurant's structured booking hours,
 * `booking_config.bookingHours` (JSONB, no migration). `null` = not
 * configured: every channel behaves as before BOOK-009 (spec AC-5).
 *
 * Shaped as one value so a future location record can own it. Times are Hong
 * Kong wall-clock `HH:MM`; a period's `first`/`last` are the first and last
 * BOOKING times (not opening/closing). Slots step from `first` by
 * `intervalMinutes` up to `last` inclusive. A special date overrides its
 * weekday; `periods: []` = closed.
 *
 * `resolveBookingHours` never throws (like `resolveBookingConfig`): it
 * resolves the stored blob field by field, and anything that leaves the
 * restaurant's times unknowable (not an object, no weekly table, a malformed
 * period) resolves the whole value to null.
 *
 * BOOK-009 F1 (P2-1 ruling, 2026-11-20): `scheduleEnabled` is the "Use
 * booking hours" switch. Off → the slot rules bind no channel (any time, as
 * BOOK-001), while terms, info and table time still apply. Stored without it
 * (before F1) → on only when some weekday or special date has a period.
 */
import { resolveBookingLimits, type BookingLimits } from './booking-limits'
import { isSafeHttpsUrl } from './safe-https-url'

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
export type IntervalMinutes = 15 | 30 | 60
export type NoticeHours = 0 | 1 | 2 | 3 | 6 | 12 | 24
export type AheadDays = 7 | 14 | 30 | 60 | 90
export type TableMinutes = 90 | 120 | 150 | 180
export type BookingHoursLanguage = 'zh_hk' | 'en'

export interface BookingPeriod {
  label?: string
  /** HH:MM, the first booking time. */
  first: string
  /** HH:MM, the last booking time (≥ first, ≤ 23:45). */
  last: string
}

export interface SpecialBookingDate {
  /** YYYY-MM-DD */
  date: string
  label?: string
  /** [] = closed that day. */
  periods: BookingPeriod[]
}

export interface BookingHours {
  /** P2-1: the schedule switch; false = any time (slot rules skipped on every channel). */
  scheduleEnabled: boolean
  weekly: Record<Weekday, BookingPeriod[]>
  intervalMinutes: IntervalMinutes
  noticeHours: NoticeHours
  aheadDays: AheadDays
  special: SpecialBookingDate[]
  tableMinutes: TableMinutes | null
  /** '' = none; either set means a diner must accept them to book. */
  terms: Record<BookingHoursLanguage, string>
  /** Shown on the booking page; '' = none. */
  info: { address: string; phone: string; mapUrl: string }
  /** BOOK-010: guest limits; absent = no limit (spec AC-3). */
  limits?: BookingLimits
}

export const WEEKDAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
export const INTERVAL_OPTIONS: readonly IntervalMinutes[] = [15, 30, 60]
export const NOTICE_OPTIONS: readonly NoticeHours[] = [0, 1, 2, 3, 6, 12, 24]
export const AHEAD_OPTIONS: readonly AheadDays[] = [7, 14, 30, 60, 90]
export const TABLE_MINUTES_OPTIONS: readonly TableMinutes[] = [90, 120, 150, 180]
export const HOURS_LANGUAGES: readonly BookingHoursLanguage[] = ['zh_hk', 'en']

export const TERMS_MAX_CHARS = 1000
export const ADDRESS_MAX_CHARS = 200
export const PHONE_MAX_CHARS = 30
export const PERIOD_LABEL_MAX_CHARS = 30
export const MAX_PERIODS_PER_DAY = 4
export const MAX_SPECIAL_DATES = 100
/** Spec: no period crosses midnight; the last booking is at most 23:45. */
export const LATEST_BOOKING_TIME = '23:45'

/** The starting point the settings form offers when hours are first turned on (spec Open Question 2: empty). */
export const EMPTY_BOOKING_HOURS: BookingHours = {
  scheduleEnabled: true,
  weekly: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
  intervalMinutes: 30,
  noticeHours: 2,
  aheadDays: 30,
  special: [],
  tableMinutes: null,
  terms: { zh_hk: '', en: '' },
  info: { address: '', phone: '', mapUrl: '' },
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
export const isBookingTime = (v: unknown): v is string => typeof v === 'string' && TIME.test(v)
export const isOption = <T>(options: readonly T[], v: unknown): v is T => options.includes(v as T)
/** Characters as Postgres `char_length` counts them (code points). */
export const charLength = (s: string) => [...s].length

const asRecord = (raw: unknown) => (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null) as Record<string, unknown> | null
const text = (raw: unknown, max: number) => (typeof raw === 'string' ? [...raw.trim()].slice(0, max).join('') : '')

function resolveLabel(raw: unknown): { label?: string } {
  const label = text(raw, PERIOD_LABEL_MAX_CHARS)
  return label === '' ? {} : { label }
}

/** null when the list or any period in it is malformed. */
function resolvePeriods(raw: unknown): BookingPeriod[] | null {
  if (!Array.isArray(raw)) return null
  const periods: BookingPeriod[] = []
  for (const item of raw) {
    const p = asRecord(item)
    if (!p || !isBookingTime(p.first) || !isBookingTime(p.last)) return null
    periods.push({ ...resolveLabel(p.label), first: p.first, last: p.last })
  }
  return periods
}

function resolveWeekly(raw: unknown): BookingHours['weekly'] | null {
  const r = asRecord(raw)
  if (!r) return null
  const weekly = {} as BookingHours['weekly']
  for (const day of WEEKDAYS) {
    const periods = r[day] === undefined ? [] : resolvePeriods(r[day])
    if (!periods) return null
    weekly[day] = periods
  }
  return weekly
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/** A malformed special date is dropped; the rest of the list stands. */
function resolveSpecial(raw: unknown): SpecialBookingDate[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    const s = asRecord(item)
    const periods = s ? resolvePeriods(s.periods) : null
    if (!s || !periods || !isCalendarDate(s.date)) return []
    return [{ date: s.date, ...resolveLabel(s.label), periods }]
  })
}

function resolveTexts(raw: unknown): BookingHours['terms'] {
  const r = asRecord(raw) ?? {}
  return { zh_hk: text(r.zh_hk, TERMS_MAX_CHARS), en: text(r.en, TERMS_MAX_CHARS) }
}

function resolveInfo(raw: unknown): BookingHours['info'] {
  const r = asRecord(raw) ?? {}
  const mapUrl = text(r.mapUrl, 2048)
  // P3-1: re-checked on read, like externalUrl (BOOK-001 R14): only an https link reaches the page.
  return { address: text(r.address, ADDRESS_MAX_CHARS), phone: text(r.phone, PHONE_MAX_CHARS), mapUrl: isSafeHttpsUrl(mapUrl) ? mapUrl : '' }
}

/** Some weekday or special date has a period (the pre-F1 meaning of "hours are on"). */
export function hasAnyPeriod(hours: Pick<BookingHours, 'weekly' | 'special'>): boolean {
  return WEEKDAYS.some((d) => hours.weekly[d].length > 0) || hours.special.some((s) => s.periods.length > 0)
}

export function resolveBookingHours(raw: unknown): BookingHours | null {
  const r = asRecord(raw)
  const weekly = r ? resolveWeekly(r.weekly) : null
  if (!r || !weekly) return null
  const d = EMPTY_BOOKING_HOURS
  const special = resolveSpecial(r.special)
  const limits = resolveBookingLimits(r.limits)
  return {
    scheduleEnabled: typeof r.scheduleEnabled === 'boolean' ? r.scheduleEnabled : hasAnyPeriod({ weekly, special }),
    weekly,
    intervalMinutes: isOption(INTERVAL_OPTIONS, r.intervalMinutes) ? r.intervalMinutes : d.intervalMinutes,
    noticeHours: isOption(NOTICE_OPTIONS, r.noticeHours) ? r.noticeHours : d.noticeHours,
    aheadDays: isOption(AHEAD_OPTIONS, r.aheadDays) ? r.aheadDays : d.aheadDays,
    special,
    tableMinutes: isOption(TABLE_MINUTES_OPTIONS, r.tableMinutes) ? r.tableMinutes : null,
    terms: resolveTexts(r.terms),
    info: resolveInfo(r.info),
    ...(limits ? { limits } : {}),
  }
}

/** Spec S1.7: either language set → the diner must accept the terms. */
export function termsRequired(hours: Pick<BookingHours, 'terms'> | null | undefined): boolean {
  return !!hours && (hours.terms.zh_hk !== '' || hours.terms.en !== '')
}

/**
 * Spec AC-10: the exact text a diner accepted, stored on the booking. The
 * booking page is bilingual, so both set languages are kept (zh-HK first).
 */
export function termsSnapshot(hours: BookingHours | null): string | null {
  if (!hours || !termsRequired(hours)) return null
  return HOURS_LANGUAGES.map((lang) => hours.terms[lang]).filter((t) => t !== '').join('\n\n')
}

/** Spec S1.4: dates before `today` drop out of the list the admin sees. */
export function withoutPastSpecialDates(hours: BookingHours, today: string): BookingHours {
  return { ...hours, special: hours.special.filter((s) => s.date >= today) }
}

/** P2-1: the hours whose slot rules bind every channel now; null when unset or the schedule switch is off. */
export function activeSchedule(hours: BookingHours | null | undefined): BookingHours | null {
  return hours && hours.scheduleEnabled ? hours : null
}

/** P2-1: terms, restaurant info or table time, which apply with the schedule on or off. */
export function hasBookingDetails(hours: BookingHours): boolean {
  const { info } = hours
  return termsRequired(hours) || hours.tableMinutes !== null || info.address !== '' || info.phone !== '' || info.mapUrl !== ''
}

/**
 * P2-1 (spec AC-5): null when nothing in the value has an effect (schedule
 * off and no terms, info or table time), so it behaves exactly as unset.
 */
export function bookingHoursInEffect(hours: BookingHours | null | undefined): BookingHours | null {
  return hours && (hours.scheduleEnabled || hasBookingDetails(hours)) ? hours : null
}

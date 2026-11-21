/**
 * BOOK-009 spec AC-2 (threat R1): validate the booking hours an admin saves.
 * Every problem is reported under its own path, so the settings form can show
 * it next to the field (`bookingHours.weekly.wed.0`, `bookingHours.special.
 * 2026-12-24`, `bookingHours.terms.en`, `bookingHours.info.mapUrl`); any
 * error saves nothing. `null` turns booking hours off (AC-5).
 */
import {
  ADDRESS_MAX_CHARS,
  AHEAD_OPTIONS,
  charLength,
  EMPTY_BOOKING_HOURS,
  hasAnyPeriod,
  HOURS_LANGUAGES,
  INTERVAL_OPTIONS,
  isBookingTime,
  isCalendarDate,
  isOption,
  LATEST_BOOKING_TIME,
  MAX_PERIODS_PER_DAY,
  MAX_SPECIAL_DATES,
  NOTICE_OPTIONS,
  PERIOD_LABEL_MAX_CHARS,
  PHONE_MAX_CHARS,
  TABLE_MINUTES_OPTIONS,
  TERMS_MAX_CHARS,
  WEEKDAYS,
  type BookingHours,
  type BookingPeriod,
  type SpecialBookingDate,
} from './booking-hours'
import { isSafeHttpsUrl } from './safe-https-url'
import { parseBookingLimits } from './booking-limits'

export type BookingHoursErrors = Record<`bookingHours${string}`, string>
export type ParseBookingHoursResult = { ok: true; hours: BookingHours | null } | { ok: false; errors: BookingHoursErrors }

const P = 'bookingHours'
// BOOK-010: `limits` is optional, so it is not part of the empty form value.
const KEYS = [...Object.keys(EMPTY_BOOKING_HOURS), 'limits']
const asRecord = (raw: unknown) => (raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null)

/** Collects errors by path while the value is parsed. */
class Errors {
  readonly byPath: BookingHoursErrors = {}
  add(path: string, code: string) {
    const key = path === '' ? P : (`${P}.${path}` as const)
    if (!(key in this.byPath)) this.byPath[key as `bookingHours${string}`] = code
  }
  get any() {
    return Object.keys(this.byPath).length > 0
  }
}

/** The first problem of one period on its own, or null. */
function periodProblem(raw: unknown): string | null {
  const p = asRecord(raw)
  if (!p || !isBookingTime(p.first) || !isBookingTime(p.last)) return 'invalid_time'
  if (p.first > LATEST_BOOKING_TIME || p.last > LATEST_BOOKING_TIME) return 'invalid_time'
  if (p.last < p.first) return 'last_before_first'
  if (p.label !== undefined && typeof p.label !== 'string') return 'invalid_label'
  if (typeof p.label === 'string' && charLength(p.label.trim()) > PERIOD_LABEL_MAX_CHARS) return 'label_too_long'
  return null
}

const overlaps = (a: BookingPeriod, b: BookingPeriod) => a.first <= b.last && b.first <= a.last

function toPeriod(p: Record<string, unknown>): BookingPeriod {
  const label = typeof p.label === 'string' ? p.label.trim() : ''
  return { ...(label === '' ? {} : { label }), first: p.first as string, last: p.last as string }
}

/** A day's periods; `report(index, code)` gets each problem (index -1 = the list itself). */
function parsePeriods(raw: unknown, report: (index: number, code: string) => void): BookingPeriod[] {
  if (!Array.isArray(raw)) return report(-1, 'invalid'), []
  if (raw.length > MAX_PERIODS_PER_DAY) return report(-1, 'too_many_periods'), []
  const valid: BookingPeriod[] = []
  raw.forEach((item, i) => {
    const problem = periodProblem(item)
    if (problem) return report(i, problem)
    const period = toPeriod(item as Record<string, unknown>)
    if (valid.some((v) => overlaps(v, period))) return report(i, 'overlap')
    valid.push(period)
  })
  return valid
}

function parseWeekly(raw: unknown, errors: Errors): BookingHours['weekly'] {
  const weekly = { ...EMPTY_BOOKING_HOURS.weekly }
  const r = asRecord(raw)
  if (!r) return errors.add('weekly', 'invalid'), weekly
  for (const day of WEEKDAYS) {
    if (r[day] === undefined) continue
    weekly[day] = parsePeriods(r[day], (i, code) => errors.add(i < 0 ? `weekly.${day}` : `weekly.${day}.${i}`, code))
  }
  return weekly
}

function parseSpecialDate(raw: unknown, index: number, ctx: { today: string; seen: Set<string>; errors: Errors }): SpecialBookingDate | null {
  const s = asRecord(raw)
  if (!s || !isCalendarDate(s.date)) return ctx.errors.add(`special.${index}`, 'invalid_date'), null
  const at = `special.${s.date}`
  if (s.date < ctx.today) return ctx.errors.add(at, 'past'), null
  if (ctx.seen.has(s.date)) return ctx.errors.add(at, 'duplicate'), null
  ctx.seen.add(s.date)
  const label = typeof s.label === 'string' ? s.label.trim() : ''
  if (charLength(label) > PERIOD_LABEL_MAX_CHARS) return ctx.errors.add(at, 'label_too_long'), null
  const periods = parsePeriods(s.periods, (_i, code) => ctx.errors.add(at, code))
  return { date: s.date, ...(label === '' ? {} : { label }), periods }
}

function parseSpecial(raw: unknown, today: string, errors: Errors): SpecialBookingDate[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) return errors.add('special', 'invalid'), []
  if (raw.length > MAX_SPECIAL_DATES) return errors.add('special', 'too_many'), []
  const ctx = { today, seen: new Set<string>(), errors }
  return raw.flatMap((item, i) => parseSpecialDate(item, i, ctx) ?? [])
}

function parseText(raw: unknown, max: number, path: string, errors: Errors): string {
  if (raw === undefined || raw === null) return ''
  if (typeof raw !== 'string') return errors.add(path, 'invalid'), ''
  const value = raw.trim()
  if (charLength(value) > max) errors.add(path, 'too_long')
  return value
}

function parseTerms(raw: unknown, errors: Errors): BookingHours['terms'] {
  const r = asRecord(raw) ?? {}
  const [zh_hk, en] = HOURS_LANGUAGES.map((lang) => parseText(r[lang], TERMS_MAX_CHARS, `terms.${lang}`, errors))
  return { zh_hk, en }
}

function parseInfo(raw: unknown, errors: Errors): BookingHours['info'] {
  const r = asRecord(raw) ?? {}
  const mapUrl = parseText(r.mapUrl, 2048, 'info.mapUrl', errors)
  if (mapUrl !== '' && !isSafeHttpsUrl(mapUrl)) errors.add('info.mapUrl', 'invalid_https_url')
  return {
    address: parseText(r.address, ADDRESS_MAX_CHARS, 'info.address', errors),
    phone: parseText(r.phone, PHONE_MAX_CHARS, 'info.phone', errors),
    mapUrl,
  }
}

function option<T>(options: readonly T[], raw: unknown, fallback: T, path: string, errors: Errors): T {
  if (raw === undefined) return fallback
  if (isOption(options, raw)) return raw
  return errors.add(path, 'invalid'), fallback
}

/** P2-1: the schedule switch; absent (a pre-F1 client) = on only when some day has a period. */
function parseScheduleEnabled(raw: unknown, schedule: Pick<BookingHours, 'weekly' | 'special'>, errors: Errors): boolean {
  if (raw === undefined) return hasAnyPeriod(schedule)
  if (typeof raw === 'boolean') return raw
  return errors.add('scheduleEnabled', 'invalid'), false
}

function parseFields(r: Record<string, unknown>, today: string, errors: Errors): BookingHours {
  const d = EMPTY_BOOKING_HOURS
  const tableMinutes = r.tableMinutes === null ? null : option(TABLE_MINUTES_OPTIONS, r.tableMinutes, null, 'tableMinutes', errors)
  const weekly = parseWeekly(r.weekly, errors)
  const special = parseSpecial(r.special, today, errors)
  const limits = parseBookingLimits(r.limits, (path, code) => errors.add(path === '' ? 'limits' : `limits.${path}`, code))
  return {
    scheduleEnabled: parseScheduleEnabled(r.scheduleEnabled, { weekly, special }, errors),
    weekly,
    intervalMinutes: option(INTERVAL_OPTIONS, r.intervalMinutes, d.intervalMinutes, 'intervalMinutes', errors),
    noticeHours: option(NOTICE_OPTIONS, r.noticeHours, d.noticeHours, 'noticeHours', errors),
    aheadDays: option(AHEAD_OPTIONS, r.aheadDays, d.aheadDays, 'aheadDays', errors),
    special,
    tableMinutes,
    terms: parseTerms(r.terms, errors),
    info: parseInfo(r.info, errors),
    ...(limits ? { limits } : {}),
  }
}

/** Validates `bookingHours` from a settings save; `today` is Hong Kong today (special dates must not be past). */
export function parseBookingHoursSettings(raw: unknown, today: string): ParseBookingHoursResult {
  if (raw === null) return { ok: true, hours: null }
  const errors = new Errors()
  const r = asRecord(raw)
  if (!r) return errors.add('', 'invalid'), { ok: false, errors: errors.byPath }
  const unknownKey = Object.keys(r).find((k) => !KEYS.includes(k))
  if (unknownKey) return errors.add('', `unknown_field:${unknownKey}`), { ok: false, errors: errors.byPath }
  const hours = parseFields(r, today, errors)
  return errors.any ? { ok: false, errors: errors.byPath } : { ok: true, hours }
}

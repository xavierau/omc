/**
 * BOOK-001: parse a diner's booking-page submission (R3, spec AC-11).
 *
 * Parsed once at the boundary; everything downstream trusts the result.
 * Identity fields a tampered client may send (restaurant, phone, token) are
 * dropped silently: they are never read (R2; restaurant and phone come only
 * from the token row). Any other unknown field is rejected, as is any value
 * outside the form's rules. Errors are per field so the page can show them
 * next to the input.
 *
 * BOOK-009 (plan D2): when the restaurant set booking hours, the slot must be
 * bookable (`checkSlot`: closed_day on date; outside_hours, too_soon, too_far
 * on time); when it set booking terms, `acceptTerms: true` is required
 * (terms_required). Without either, results are exactly BOOK-001's (AC-5).
 * Every channel (booking page, personal agents, AI agent tools) parses here.
 */
import type { BookingHours } from '@/domain/value-objects/booking-hours'
import { checkSlot } from './booking-hours'

export interface BookingSubmission {
  /** YYYY-MM-DD, today or later in Asia/Hong_Kong. */
  date: string
  /** HH:MM, 24-hour; later than now when the date is today (F6). */
  time: string
  partySize: number
  name: string
  notes: string | null
  /** BOOK-009: present only when the restaurant's terms were required and accepted. */
  termsAccepted?: true
}

export type BookingFieldErrors = Record<string, string>

export type ParseBookingSubmissionResult =
  | { ok: true; submission: BookingSubmission }
  | { ok: false; errors: BookingFieldErrors }

export const NAME_MAX = 60
export const NOTES_MAX = 500
const FORM_FIELDS = ['date', 'time', 'partySize', 'name', 'notes', 'acceptTerms']
const IGNORED_IDENTITY_FIELDS = ['restaurantId', 'restaurant_id', 'restaurantSlug', 'slug', 'phone', 'token']

/** Today's date in Hong Kong as YYYY-MM-DD. */
export function hongKongToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** The wall-clock time in Hong Kong as HH:MM (24-hour). */
export function hongKongTime(now: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Hong_Kong',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now)
}

/** Characters as Postgres `char_length` counts them (code points). */
const charLength = (s: string) => [...s].length

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function parseDate(raw: unknown, today: string, errors: BookingFieldErrors): string {
  if (typeof raw !== 'string' || raw === '') return (errors.date = 'required'), ''
  if (!isCalendarDate(raw)) return (errors.date = 'invalid'), ''
  if (raw < today) return (errors.date = 'past'), ''
  return raw
}

function parseTime(raw: unknown, errors: BookingFieldErrors): string {
  if (typeof raw !== 'string' || raw === '') return (errors.time = 'required'), ''
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) return (errors.time = 'invalid'), ''
  return raw
}

function parsePartySize(raw: unknown, max: number, errors: BookingFieldErrors): number {
  if (raw === undefined || raw === null || raw === '') return (errors.partySize = 'required'), 0
  const text = typeof raw === 'number' ? String(raw) : raw
  if (typeof text !== 'string' || !/^\d+$/.test(text)) return (errors.partySize = 'invalid'), 0
  const size = Number(text)
  if (size < 1) return (errors.partySize = 'too_small'), 0
  if (size > max) return (errors.partySize = 'too_large'), 0
  return size
}

function parseName(raw: unknown, errors: BookingFieldErrors): string {
  const name = typeof raw === 'string' ? raw.trim() : ''
  if (name === '') return (errors.name = 'required'), ''
  if (charLength(name) > NAME_MAX) return (errors.name = 'too_long'), ''
  return name
}

function parseNotes(raw: unknown, errors: BookingFieldErrors): string | null {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'string') return (errors.notes = 'invalid'), null
  const notes = raw.trim()
  if (charLength(notes) > NOTES_MAX) return (errors.notes = 'too_long'), null
  return notes === '' ? null : notes
}

export interface BookingSubmissionRules {
  /** Hong Kong today, YYYY-MM-DD. */
  today: string
  /** Hong Kong now, HH:MM: a booking today must start later than this (F6). */
  nowTime: string
  maxPartySize: number
  /** BOOK-009: the restaurant's booking hours; null/absent = any time (BOOK-001). */
  hours?: BookingHours | null
  /** BOOK-009: the restaurant set booking terms, so the diner must accept them. */
  termsRequired?: boolean
}

// F6 (review #4): today at a time already past is refused on the time field.
// No upper bound on the date (spec AC-11 asks only for today or later).
function checkNotPastToday(s: BookingSubmission, rules: BookingSubmissionRules, errors: BookingFieldErrors): void {
  if (errors.date || errors.time) return
  if (s.date === rules.today && s.time <= rules.nowTime) errors.time = 'past_time'
}

/** BOOK-009: a well-formed slot must also be one the restaurant takes now. */
function checkBookingHours(s: BookingSubmission, rules: BookingSubmissionRules, errors: BookingFieldErrors): void {
  if (errors.date || errors.time || !rules.hours) return
  const refusal = checkSlot(rules.hours, s.date, s.time, rules)
  if (refusal === 'closed_day') errors.date = refusal
  else if (refusal) errors.time = refusal
}

/** BOOK-009: true only when terms are required and the diner ticked them. */
function parseAcceptTerms(raw: unknown, required: boolean, errors: BookingFieldErrors): boolean {
  if (raw !== undefined && typeof raw !== 'boolean') return (errors.acceptTerms = 'invalid'), false
  if (required && raw !== true) return (errors.acceptTerms = 'terms_required'), false
  return required
}

export function parseBookingSubmission(
  body: unknown,
  rules: BookingSubmissionRules
): ParseBookingSubmissionResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, errors: { form: 'invalid_body' } }
  const b = body as Record<string, unknown>
  const errors: BookingFieldErrors = {}
  for (const key of Object.keys(b)) {
    if (!FORM_FIELDS.includes(key) && !IGNORED_IDENTITY_FIELDS.includes(key)) errors[key] = 'unknown_field'
  }
  const submission: BookingSubmission = {
    date: parseDate(b.date, rules.today, errors),
    time: parseTime(b.time, errors),
    partySize: parsePartySize(b.partySize, rules.maxPartySize, errors),
    name: parseName(b.name, errors),
    notes: parseNotes(b.notes, errors),
  }
  if (parseAcceptTerms(b.acceptTerms, rules.termsRequired === true, errors)) submission.termsAccepted = true
  checkNotPastToday(submission, rules, errors)
  checkBookingHours(submission, rules, errors)
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, submission }
}

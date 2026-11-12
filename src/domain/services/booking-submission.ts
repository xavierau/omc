/**
 * BOOK-001: parse a diner's booking-page submission (R3, spec AC-11).
 *
 * Parsed once at the boundary; everything downstream trusts the result.
 * Identity fields a tampered client may send (restaurant, phone, token) are
 * dropped silently: they are never read (R2; restaurant and phone come only
 * from the token row). Any other unknown field is rejected, as is any value
 * outside the form's rules. Errors are per field so the page can show them
 * next to the input.
 */
export interface BookingSubmission {
  /** YYYY-MM-DD, today or later in Asia/Hong_Kong. */
  date: string
  /** HH:MM, 24-hour. */
  time: string
  partySize: number
  name: string
  notes: string | null
}

export type BookingFieldErrors = Record<string, string>

export type ParseBookingSubmissionResult =
  | { ok: true; submission: BookingSubmission }
  | { ok: false; errors: BookingFieldErrors }

export const NAME_MAX = 60
export const NOTES_MAX = 500
const FORM_FIELDS = ['date', 'time', 'partySize', 'name', 'notes']
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

export function parseBookingSubmission(
  body: unknown,
  rules: { today: string; maxPartySize: number }
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
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, submission }
}

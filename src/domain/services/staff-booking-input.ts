/**
 * BOOK-013 (spec S1/S2; threat R4, R7): the staff booking form as the server
 * accepts it. An allow-list: only phone, name, partySize, date, time, notes,
 * notify, override (and expectedUpdatedAt on an edit) are read; any other key
 * (status, source, member_id, checkin_code, restaurant_id …) is ignored, so
 * the server alone sets those. Field errors are never overridable: `override`
 * only answers the booking-rules prompt (owner decision 3).
 */
import { isBookingTime, charLength } from '@/domain/value-objects/booking-hours'
import { absoluteMinutes } from './booking-calendar'
import type { BookingClock } from './booking-hours'

export const STAFF_NAME_MAX = 60
export const STAFF_NOTES_MAX = 500

export interface StaffBookingInput {
  /** E.164, normalised by the repo's one phone normaliser. */
  phone: string
  name: string
  partySize: number
  date: string
  time: string
  notes: string | null
  /** Owner decision 2: send the diner messages (and the 3h reminder); default on. */
  notify: boolean
  /** Owner decision 3: staff saw the broken rules and book anyway. */
  override: boolean
}

export type StaffBookingField = 'phone' | 'name' | 'partySize' | 'date' | 'time' | 'notes' | 'notify' | 'override' | 'expectedUpdatedAt' | 'form'
export type StaffBookingErrors = Partial<Record<StaffBookingField, string>>

export interface StaffBookingContext {
  maxPartySize: number
  clock: BookingClock
  /** E.164 or null when the text is not a phone number. */
  normalizePhone(raw: string): string | null
  /** Edit: the slot the booking holds now. An unchanged slot may be in the past (notes after arrival). */
  currentSlot?: { date: string; time: string }
  /** Edit: the body must carry the `updatedAt` the form loaded (R3). */
  requireExpectedUpdatedAt?: boolean
}

export type StaffBookingParse =
  | { ok: true; input: StaffBookingInput; expectedUpdatedAt: string | null }
  | { ok: false; errors: StaffBookingErrors }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const isRealDate = (v: unknown): v is string =>
  typeof v === 'string' && ISO_DATE.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v
const flat = (v: string) => v.replace(/[\s\u0000-\u001f\u007f]+/g, ' ').trim()

function parseName(raw: unknown, errors: StaffBookingErrors): string {
  const name = typeof raw === 'string' ? flat(raw) : ''
  if (name === '') errors.name = 'required'
  else if (charLength(name) > STAFF_NAME_MAX) errors.name = 'too_long'
  return name
}

function parseNotes(raw: unknown, errors: StaffBookingErrors): string | null {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'string') return (errors.notes = 'invalid'), null
  const notes = raw.trim()
  if (charLength(notes) > STAFF_NOTES_MAX) errors.notes = 'too_long'
  return notes === '' ? null : notes
}

function parseParty(raw: unknown, max: number, errors: StaffBookingErrors): number {
  const n = typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw) : raw
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) errors.partySize = 'invalid'
  else if (n > max) errors.partySize = 'above_max'
  return typeof n === 'number' ? n : 0
}

function parsePhone(raw: unknown, ctx: StaffBookingContext, errors: StaffBookingErrors): string {
  if (typeof raw !== 'string' || raw.trim() === '') return (errors.phone = 'required'), ''
  const phone = raw.length <= 40 ? ctx.normalizePhone(raw) : null
  if (!phone) errors.phone = 'invalid'
  return phone ?? ''
}

function optionalBool(raw: unknown, fallback: boolean, field: StaffBookingField, errors: StaffBookingErrors): boolean {
  if (raw === undefined) return fallback
  if (typeof raw !== 'boolean') errors[field] = 'invalid'
  return raw === true
}

const sameSlot = (ctx: StaffBookingContext, date: string, time: string) =>
  ctx.currentSlot?.date === date && ctx.currentSlot?.time === time

/** R7: a date-time before Hong Kong now is refused, unless an edit keeps the slot it already had. */
function checkWhen(date: string, time: string, ctx: StaffBookingContext, errors: StaffBookingErrors): void {
  if (!isRealDate(date)) errors.date = 'invalid'
  if (!isBookingTime(time)) errors.time = 'invalid'
  if (errors.date || errors.time || sameSlot(ctx, date, time)) return
  if (absoluteMinutes(date, time) < absoluteMinutes(ctx.clock.today, ctx.clock.nowTime)) errors.time = 'past'
}

function parseExpected(raw: unknown, ctx: StaffBookingContext, errors: StaffBookingErrors): string | null {
  if (!ctx.requireExpectedUpdatedAt) return null
  if (typeof raw === 'string' && raw.length <= 64 && !Number.isNaN(Date.parse(raw))) return raw
  errors.expectedUpdatedAt = 'required'
  return null
}

export function parseStaffBookingInput(body: unknown, ctx: StaffBookingContext): StaffBookingParse {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, errors: { form: 'invalid_body' } }
  const b = body as Record<string, unknown>
  const errors: StaffBookingErrors = {}
  const input: StaffBookingInput = {
    phone: parsePhone(b.phone, ctx, errors),
    name: parseName(b.name, errors),
    partySize: parseParty(b.partySize, ctx.maxPartySize, errors),
    date: typeof b.date === 'string' ? b.date : '',
    time: typeof b.time === 'string' ? b.time : '',
    notes: parseNotes(b.notes, errors),
    notify: optionalBool(b.notify, true, 'notify', errors),
    override: optionalBool(b.override, false, 'override', errors),
  }
  checkWhen(input.date, input.time, ctx, errors)
  const expectedUpdatedAt = parseExpected(b.expectedUpdatedAt, ctx, errors)
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, input, expectedUpdatedAt }
}

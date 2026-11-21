/**
 * BOOK-003: rules for bookings made by personal agents (PAP 1.0).
 *
 * The body is parsed once at the boundary (R34): the BOOK-001 field rules
 * (`parseBookingSubmission`) plus the diner's phone as E.164. Unlike the
 * booking page, identity fields are REJECTED, not dropped (R33): the tenant
 * comes only from the agent booking id in the path. Field names are the API's
 * snake_case; `party_size` maps to the form's `partySize`.
 *
 * BOOK-009 W4: `accept_terms` maps to the form's `acceptTerms` (the shared
 * parser decides whether it is required). Agents of both kinds (personal
 * agents through PAP, our AI reply agent) get the same alternatives for a
 * slot the booking hours refuse, and the same rules summary.
 */
import type { AgentBooking, BookingStatus } from '@/domain/entities/booking-request'
import { buildContactUrl } from '@/domain/services/contact-redirect'
import type { BookingHours, BookingHoursLanguage } from '@/domain/value-objects/booking-hours'
import { suggestTimes, summarize, windowEnd, type BookingClock, type SuggestedTime } from './booking-hours'
import {
  parseBookingSubmission,
  type BookingFieldErrors,
  type BookingSubmission,
  type BookingSubmissionRules,
} from './booking-submission'

export interface AgentBookingSubmission extends BookingSubmission {
  /** E.164 with a leading '+'. */
  phone: string
}

export type ParseAgentBookingResult =
  | { ok: true; submission: AgentBookingSubmission }
  | { ok: false; errors: BookingFieldErrors }

export const AGENT_BOOKING_FIELDS = ['date', 'time', 'party_size', 'name', 'phone', 'notes', 'accept_terms'] as const
const E164 = /^\+[1-9]\d{7,14}$/

function parsePhone(raw: unknown, errors: BookingFieldErrors): string {
  if (typeof raw !== 'string' || raw.trim() === '') return (errors.phone = 'required'), ''
  const phone = raw.trim()
  if (!E164.test(phone)) return (errors.phone = 'invalid'), ''
  return phone
}

export function parseAgentBookingBody(body: unknown, rules: BookingSubmissionRules): ParseAgentBookingResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, errors: { form: 'invalid_body' } }
  const b = body as Record<string, unknown>
  const errors: BookingFieldErrors = {}
  for (const key of Object.keys(b)) {
    if (!(AGENT_BOOKING_FIELDS as readonly string[]).includes(key)) errors[key] = 'unknown_field'
  }
  const phone = parsePhone(b.phone, errors)
  const form = parseBookingSubmission(
    { date: b.date, time: b.time, partySize: b.party_size, name: b.name, notes: b.notes, acceptTerms: b.accept_terms },
    rules
  )
  if (!form.ok) {
    const { partySize, acceptTerms, ...rest } = form.errors
    Object.assign(errors, rest, partySize ? { party_size: partySize } : {}, acceptTerms ? { accept_terms: acceptTerms } : {})
  }
  if (Object.keys(errors).length > 0 || !form.ok) return { ok: false, errors }
  return { ok: true, submission: { ...form.submission, phone } }
}

const HOURS_REFUSALS: readonly string[] = ['closed_day', 'outside_hours', 'too_soon', 'too_far']

/**
 * BOOK-009 (spec AC-12, AC-16): when the booking hours refused the requested
 * slot, up to 3 bookable alternatives from W1's `suggestTimes` (same date
 * first, nearest first). A date past the window gets the window's last
 * bookable times, else the earliest ones. null when no hours code is present.
 */
export function suggestionsForRefusal(
  hours: BookingHours | null | undefined,
  errors: BookingFieldErrors,
  requested: { date: string; time: string; clock: BookingClock }
): SuggestedTime[] | null {
  if (!hours || !(HOURS_REFUSALS.includes(errors.date) || HOURS_REFUSALS.includes(errors.time))) return null
  const { date, time, clock } = requested
  if (errors.time !== 'too_far') return suggestTimes(hours, date, time, clock)
  const last = suggestTimes(hours, windowEnd(hours, clock.today), time, clock)
  return last.length > 0 ? last : suggestTimes(hours, clock.today, time, clock)
}

/** BOOK-009 (spec AC-11, AC-15): the rules summary agents get, listing only the special dates inside the booking window. */
export function summarizeForAgents(hours: BookingHours, maxPartySize: number, lang: BookingHoursLanguage, today: string): string {
  const last = windowEnd(hours, today)
  const special = hours.special.filter((s) => s.date >= today && s.date <= last)
  return summarize({ ...hours, special }, maxPartySize, lang)
}

/**
 * BOOK-009 (spec AC-11, threat R2): /availability answers at most this many
 * dates. F1 (P3-4): the window is today … today + aheadDays, aheadDays + 1
 * dates, so one call can cover it. `schedule` = the active schedule (null = any time).
 */
export const AVAILABILITY_MAX_DAYS = 31
export const availabilityMaxDays = (schedule: BookingHours | null) =>
  schedule ? Math.min(AVAILABILITY_MAX_DAYS, schedule.aheadDays + 1) : AVAILABILITY_MAX_DAYS

/** F1 (P3-4): `from` may be at most this many days after today (the window, and never less than 90). */
export const AVAILABILITY_FROM_MIN_REACH_DAYS = 90
export const availabilityFromReach = (schedule: BookingHours | null) =>
  Math.max(schedule?.aheadDays ?? 0, AVAILABILITY_FROM_MIN_REACH_DAYS)

/** R46: an Idempotency-Key replay must carry the same booking. */
export function isSameAgentSubmission(booking: AgentBooking, s: AgentBookingSubmission): boolean {
  return (
    booking.phone === s.phone &&
    booking.bookingDate === s.date &&
    booking.bookingTime === s.time &&
    booking.partySize === s.partySize &&
    booking.name === s.name &&
    (booking.notes ?? null) === (s.notes ?? null)
  )
}

export const IDEMPOTENCY_WINDOW_MS = 24 * 3_600_000
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{1,255}$/

/** Printable ASCII, 1-255 chars; anything else is a 400. */
export function isValidIdempotencyKey(value: string): boolean {
  return IDEMPOTENCY_KEY.test(value)
}

export type AgentBookingStatus = 'awaiting_confirmation' | 'expired' | 'pending' | 'confirmed' | 'declined' | 'cancelled'

/**
 * What the agent sees: unverified splits into awaiting and expired by the clock.
 * BOOK-007 R7: a no-show is a staff-only mark; the agent still sees `confirmed`.
 */
export function agentBookingStatus(status: BookingStatus, verifyExpiresAt: string | null, now: Date): AgentBookingStatus {
  if (status === 'no_show') return 'confirmed'
  if (status !== 'unverified') return status
  return verifyExpiresAt !== null && Date.parse(verifyExpiresAt) > now.getTime() ? 'awaiting_confirmation' : 'expired'
}

/** R36: the status read returns these fields only, never the phone or the name. */
export interface AgentBookingStatusView {
  booking_id: string
  status: AgentBookingStatus
  date: string
  time: string
  party_size: number
  expires_at?: string
}

export function agentBookingStatusView(booking: AgentBooking, now: Date): AgentBookingStatusView {
  const status = agentBookingStatus(booking.status, booking.verifyExpiresAt, now)
  const view: AgentBookingStatusView = {
    booking_id: booking.id,
    status,
    date: booking.bookingDate,
    time: booking.bookingTime,
    party_size: booking.partySize,
  }
  if (status === 'awaiting_confirmation' && booking.verifyExpiresAt) view.expires_at = booking.verifyExpiresAt
  return view
}

/** Status tokens are 256-bit base64url (43 chars); anything else is unknown without a lookup. */
export const STATUS_TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/

/**
 * The diner confirms an agent booking on WhatsApp, so a restaurant without a
 * usable WhatsApp number cannot take one: the agent API answers 404 and the
 * dashboard refuses poppy.json (review G2).
 */
export function hasConfirmableWhatsAppNumber(whatsappNumber: string | null | undefined): whatsappNumber is string {
  return !!whatsappNumber && buildContactUrl(whatsappNumber) !== null
}

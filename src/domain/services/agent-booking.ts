/**
 * BOOK-003: rules for bookings made by personal agents (PAP 1.0).
 *
 * The body is parsed once at the boundary (R34): the BOOK-001 field rules
 * (`parseBookingSubmission`) plus the diner's phone as E.164. Unlike the
 * booking page, identity fields are REJECTED, not dropped (R33): the tenant
 * comes only from the agent booking id in the path. Field names are the API's
 * snake_case; `party_size` maps to the form's `partySize`.
 */
import type { AgentBooking, BookingStatus } from '@/domain/entities/booking-request'
import { buildContactUrl } from '@/domain/services/contact-redirect'
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

export const AGENT_BOOKING_FIELDS = ['date', 'time', 'party_size', 'name', 'phone', 'notes'] as const
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
    { date: b.date, time: b.time, partySize: b.party_size, name: b.name, notes: b.notes },
    rules
  )
  if (!form.ok) {
    const { partySize, ...rest } = form.errors
    Object.assign(errors, rest, partySize ? { party_size: partySize } : {})
  }
  if (Object.keys(errors).length > 0 || !form.ok) return { ok: false, errors }
  return { ok: true, submission: { ...form.submission, phone } }
}

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

/** What the agent sees: unverified splits into awaiting and expired by the clock. */
export function agentBookingStatus(status: BookingStatus, verifyExpiresAt: string | null, now: Date): AgentBookingStatus {
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

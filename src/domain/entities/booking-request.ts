/**
 * BOOK-001: a diner's booking request (table `booking_requests`).
 *
 * Status moves only pending -> confirmed | declined. The move itself is a
 * conditional UPDATE in the repository (R4), so two staff acting at once
 * yield one decision; this module holds the vocabulary and the limits.
 * BOOK-003: a booking made by a personal agent starts `unverified` and becomes
 * `pending` only when the diner sends its confirm code from the booking phone
 * on WhatsApp (R31, R32). Unverified bookings are invisible to staff.
 */
import type { BookingLinkSource } from '@/domain/services/booking-token'

export type BookingStatus = 'unverified' | 'pending' | 'confirmed' | 'declined'
/** BOOK-003: chat and campaign bookings come from a link; agent ones from the agent API. */
export type BookingSource = BookingLinkSource | 'agent'
export type BookingDecision = 'confirmed' | 'declined'
/** Whether the confirm/decline message reached the diner (F9); null = none yet. */
export type DecisionMessageStatus = 'delivered' | 'not_delivered'

/** R11: open requests one phone may hold at one restaurant. */
export const MAX_PENDING_PER_PHONE = 3
export const DECLINE_REASON_MAX = 200
/** F10: the dashboard lists every pending request plus this many newest decided ones. */
export const DECIDED_BOOKINGS_LIST_LIMIT = 200

/** BOOK-003 (R41): an agent booking must be confirmed on WhatsApp within this time. */
export const AGENT_VERIFY_TTL_MS = 30 * 60_000
/** BOOK-003 (R41): unverified rows older than this are deleted by the 5-minute booking-reminders cron (review F3). */
export const UNVERIFIED_RETENTION_MS = 60 * 60_000
/** BOOK-003 (R39): live unverified bookings one phone may hold at one restaurant. */
export const MAX_UNVERIFIED_PER_PHONE = 3
/** BOOK-003 (R39): live unverified bookings one restaurant may hold. */
export const MAX_UNVERIFIED_PER_RESTAURANT = 30

export interface BookingRequest {
  id: string
  restaurantId: string
  memberId: string | null
  phone: string
  name: string | null
  partySize: number
  bookingDate: string
  /** HH:MM */
  bookingTime: string
  notes: string | null
  status: BookingStatus
  declineReason: string | null
  decidedBy: string | null
  decidedAt: string | null
  source: BookingSource
  campaignId: string | null
  createdAt: string
  decisionMessageStatus: DecisionMessageStatus | null
}

/** BOOK-003: an agent booking with its phone-proof and status-token columns. */
export interface AgentBooking extends BookingRequest {
  confirmCode: string | null
  verifyExpiresAt: string | null
  verifiedAt: string | null
  verifiedWamid: string | null
  statusTokenHash: string | null
  idempotencyKey: string | null
}

export interface NewAgentBooking {
  restaurantId: string
  phone: string
  name: string
  partySize: number
  bookingDate: string
  bookingTime: string
  notes: string | null
  confirmCode: string
  verifyExpiresAt: string
  statusTokenHash: string
  idempotencyKey: string | null
}

export interface NewBookingRequest {
  restaurantId: string
  memberId: string | null
  phone: string
  name: string
  partySize: number
  bookingDate: string
  bookingTime: string
  notes: string | null
  source: BookingLinkSource
  campaignId: string | null
  token: string
}

/** A decline reason as stored: trimmed, newline-free, capped; empty = none. */
export function normalizeDeclineReason(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const reason = raw.replace(/\s+/g, ' ').trim()
  return reason === '' ? null : [...reason].slice(0, DECLINE_REASON_MAX).join('')
}

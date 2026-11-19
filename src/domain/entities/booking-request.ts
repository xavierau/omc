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

/** AGENT-003 (migration 085): `cancelled` by the diner through the AI agent, or replaced by a confirmed change. */
export type BookingStatus = 'unverified' | 'pending' | 'confirmed' | 'declined' | 'cancelled'
/** AGENT-003 R24/R23: who cancelled a booking. */
export type BookingCancelledBy = 'diner_ai' | 'change'
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
/** BOOK-003 (R39): live unverified bookings one restaurant may hold; a safety net, the per-IP caps bind first (review G1). */
export const MAX_UNVERIFIED_PER_RESTAURANT = 500
/** BOOK-003 (R39): creates one client IP may make at one restaurant per window (review G1). */
export const MAX_AGENT_CREATES_PER_IP_PER_RESTAURANT = 5
export const AGENT_CREATES_PER_IP_WINDOW_SEC = 30 * 60

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
  /**
   * AGENT-003 R23: set on a change request, the booking it would replace.
   * Read by the dashboard list and the staff decision only (undefined elsewhere).
   */
  replacesBookingId?: string | null
  /** AGENT-003: the replaced booking's slot, for the 訂座 "old → new" line. */
  replaces?: { bookingDate: string; bookingTime: string; partySize: number } | null
  cancelledBy?: BookingCancelledBy | null
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
  /** AGENT-003: the WhatsApp AI agent books as 'agent' (shown "via AI agent"), with no token. */
  source: BookingSource
  campaignId: string | null
  token: string | null
  /** AGENT-003 R23: a change request names the booking it would replace. */
  replacesBookingId?: string | null
}

/** AGENT-003 R20: one of the diner's upcoming bookings (pending or confirmed, from the Hong Kong time now on). */
export interface DinerBooking {
  id: string
  bookingDate: string
  bookingTime: string
  partySize: number
  status: 'pending' | 'confirmed'
  name: string | null
  notes: string | null
  memberId: string | null
  replacesBookingId: string | null
}

/**
 * AGENT-003 R23 (review F3): a change request is OPEN only while it is
 * pending. A confirmed change keeps `replacesBookingId` (history) but is an
 * ordinary booking from then on: listed as one and changeable again.
 */
export function isOpenChangeRequest(b: { replacesBookingId?: string | null; status: string }): boolean {
  return !!b.replacesBookingId && b.status === 'pending'
}

/** A decline reason as stored: trimmed, newline-free, capped; empty = none. */
export function normalizeDeclineReason(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const reason = raw.replace(/\s+/g, ' ').trim()
  return reason === '' ? null : [...reason].slice(0, DECLINE_REASON_MAX).join('')
}

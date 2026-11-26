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

/**
 * AGENT-003 (migration 085): `cancelled` by the diner through the AI agent, or replaced by a confirmed change.
 * BOOK-007 (migration 087): `no_show`, set by staff on a past confirmed booking (and undone back to confirmed).
 */
export type BookingStatus = 'unverified' | 'pending' | 'confirmed' | 'declined' | 'cancelled' | 'no_show'
/** AGENT-003 R24/R23: who cancelled a booking. BOOK-013 (migration 095): 'staff' = a staff cancel. */
export type BookingCancelledBy = 'diner_ai' | 'change' | 'staff'
/** BOOK-003: chat and campaign bookings come from a link; agent ones from the agent API. BOOK-013: 'staff' = made by staff. */
export type BookingSource = BookingLinkSource | 'agent' | 'staff'
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
  /**
   * BOOK-006: on an original (pending or confirmed), its open change request's
   * id and requested slot. Staff then decide only through that change row.
   * Read by the dashboard lists only (undefined elsewhere).
   */
  openChange?: OpenChangeSlot | null
  cancelledBy?: BookingCancelledBy | null
  /**
   * BOOK-009 (migration 091, spec AC-10): when the diner accepted the
   * restaurant's booking terms, and the exact text accepted; null = no terms
   * were required. Read by the dashboard lists only (undefined elsewhere).
   */
  termsAcceptedAt?: string | null
  termsText?: string | null
  /**
   * BOOK-013 (migration 095). Read by the dashboard lists and staff paths
   * only (undefined elsewhere). `updatedAt` is what a staff edit/cancel
   * sends back for its conditional write (R3).
   */
  updatedAt?: string
  createdBy?: string | null
  /** The creating staff member's display name ("By staff · Mandy"); resolved by the list route. */
  createdByName?: string | null
  notifyDiner?: boolean
  /** The 6-character check-in code, minted when the booking became confirmed (R8). */
  checkinCode?: string | null
  checkedInAt?: string | null
}

/** BOOK-006: the open (pending) change request that would replace a booking. */
export interface OpenChangeSlot {
  id: string
  bookingDate: string
  bookingTime: string
  partySize: number
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
  /** BOOK-009 AC-13: set together, only when terms were required and the agent sent accept_terms: true. */
  termsAcceptedAt?: string
  termsText?: string
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
  /** BOOK-009 AC-10: set together, only when terms were required and accepted. */
  termsAcceptedAt?: string
  termsText?: string
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

/**
 * BOOK-006: a booking staff still have to answer: pending, and not the
 * original of an open change request (that pair is answered on the change row).
 */
export function needsReply(b: { status: string; openChange?: OpenChangeSlot | null }): boolean {
  return b.status === 'pending' && !b.openChange
}

/**
 * BOOK-006 count rule: `total` pending rows minus the pending originals that
 * have an open change, found among `pending` (the pending rows read). An
 * original whose change is pending is then counted once, as its change.
 */
export function pendingNeedingReply(total: number, pending: Array<{ id: string; replacesBookingId: string | null }>): number {
  const ids = new Set(pending.map((p) => p.id))
  const pairs = pending.filter((p) => p.replacesBookingId !== null && ids.has(p.replacesBookingId)).length
  return total - pairs
}

/**
 * BOOK-004 (R4): the most rows one date-range list returns; more sets `truncated`.
 * The list reads cap + 1 rows, which must fit PostgREST's `max_rows` (1000), or
 * the extra row is never returned and a cut list looks complete (review F1).
 */
export const BOOKINGS_RANGE_CAP = 999
/** BOOK-004 (R3): the widest date range one list may ask for, in days. */
export const BOOKINGS_RANGE_MAX_DAYS = 400

/** Inclusive on `booking_date`, both YYYY-MM-DD. */
export interface BookingDateRange {
  from: string
  to: string
}

export type BookingRangeParse = { ok: true; range: BookingDateRange | null } | { ok: false }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Days since the epoch for a real calendar date, or null (R3: format and date both checked). */
function epochDay(value: string): number | null {
  if (!ISO_DATE.test(value)) return null
  const [y, m, d] = value.split('-').map(Number)
  const ms = Date.UTC(y, m - 1, d)
  return new Date(ms).toISOString().slice(0, 10) === value ? ms / 86_400_000 : null
}

/** BOOK-004: neither param = no range; both valid, ordered and ≤ 400 days apart = a range; anything else is rejected. */
export function parseBookingRange(from: string | null, to: string | null): BookingRangeParse {
  if (from === null && to === null) return { ok: true, range: null }
  const start = from === null ? null : epochDay(from)
  const end = to === null ? null : epochDay(to)
  if (start === null || end === null || start > end || end - start > BOOKINGS_RANGE_MAX_DAYS) return { ok: false }
  return { ok: true, range: { from: from as string, to: to as string } }
}

/** A decline reason as stored: trimmed, newline-free, capped; empty = none. */
export function normalizeDeclineReason(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const reason = raw.replace(/\s+/g, ' ').trim()
  return reason === '' ? null : [...reason].slice(0, DECLINE_REASON_MAX).join('')
}

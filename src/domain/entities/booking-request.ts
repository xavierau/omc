/**
 * BOOK-001: a diner's booking request (table `booking_requests`).
 *
 * Status moves only pending -> confirmed | declined. The move itself is a
 * conditional UPDATE in the repository (R4), so two staff acting at once
 * yield one decision; this module holds the vocabulary and the limits.
 */
import type { BookingLinkSource } from '@/domain/services/booking-token'

export type BookingStatus = 'pending' | 'confirmed' | 'declined'
export type BookingDecision = 'confirmed' | 'declined'
/** Whether the confirm/decline message reached the diner (F9); null = none yet. */
export type DecisionMessageStatus = 'delivered' | 'not_delivered'

/** R11: open requests one phone may hold at one restaurant. */
export const MAX_PENDING_PER_PHONE = 3
export const DECLINE_REASON_MAX = 200
/** F10: the dashboard lists every pending request plus this many newest decided ones. */
export const DECIDED_BOOKINGS_LIST_LIMIT = 200

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
  source: BookingLinkSource
  campaignId: string | null
  createdAt: string
  decisionMessageStatus: DecisionMessageStatus | null
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

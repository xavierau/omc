/**
 * BOOK-001: ports the booking use cases depend on. Supabase adapters live in
 * `src/infrastructure/supabase/repositories/booking-*-repository.ts`; tests
 * use in-memory fakes with the same atomicity (first claim wins).
 */
import type { BookingDecision, BookingRequest, NewBookingRequest } from '@/domain/entities/booking-request'
import type { BookingLinkSource, BookingTokenState } from '@/domain/services/booking-token'
import type { BookingMessageDetails, BookingMessageKind } from '@/domain/services/booking-message'
import type { BookingConfig } from '@/domain/value-objects/booking-config'

/** Identity a booking gets: only ever from the token row (R2). */
export interface BookingTokenOwner {
  restaurantId: string
  phone: string
  source: BookingLinkSource
  campaignId: string | null
}

export interface BookingTokenStore {
  /** Reads state without consuming: a page load is not a submission. */
  peek(token: string, now: Date): Promise<{ state: BookingTokenState; owner: BookingTokenOwner | null }>
  /** Atomic single-use claim; null to every caller but the one that won (R1). */
  claim(token: string, now: Date): Promise<BookingTokenOwner | null>
  /** Undo a claim whose booking insert failed, so the diner can retry. */
  release(token: string, claimedAt: Date): Promise<void>
}

export interface DecideBookingArgs {
  id: string
  restaurantId: string
  decision: BookingDecision
  decidedBy: string
  decidedAt: Date
  declineReason: string | null
}

export interface BookingRequestStore {
  insert(request: NewBookingRequest): Promise<BookingRequest>
  countPending(restaurantId: string, phone: string): Promise<number>
  listForRestaurant(restaurantId: string, limit: number): Promise<BookingRequest[]>
  findForRestaurant(id: string, restaurantId: string): Promise<BookingRequest | null>
  /** Conditional pending -> decision, scoped by restaurant; null if no row changed (R4, R6). */
  decide(args: DecideBookingArgs): Promise<BookingRequest | null>
}

export interface BookingRestaurantContext {
  name: string
  logoUrl: string | null
  whatsappNumber: string | null
}

export interface BookingSettingsReader {
  getConfig(restaurantId: string): Promise<BookingConfig>
  getRestaurant(restaurantId: string): Promise<BookingRestaurantContext | null>
  /** The campaign's own booking URL, scoped to the restaurant (R15). */
  getCampaignBookingUrl(campaignId: string, restaurantId: string): Promise<string | null>
}

export type BookingSendResult =
  | { delivered: true; via: 'template' | 'text' }
  | { delivered: false; reason: 'outside_window' | 'send_failed' | 'no_sender' | 'error' }

export interface BookingMessageInput {
  restaurantId: string
  phone: string
  memberId: string | null
  kind: BookingMessageKind
  details: BookingMessageDetails
}

/** Never throws: a failed send must not undo or fail the booking state. */
export interface BookingMessageSender {
  send(input: BookingMessageInput): Promise<BookingSendResult>
}

export interface BookingMemberLookup {
  /** Existing member id for this phone at this restaurant; never creates one (R21). */
  findMemberId(restaurantId: string, phone: string): Promise<string | null>
}

/** W3 (AC-15): confirmed bookings awaiting their one reminder, across restaurants (cron only). */
export interface BookingReminderStore {
  /** Confirmed, reminder not sent, booking_date in [fromDate, toDate]. */
  listReminderCandidates(fromDate: string, toDate: string, limit: number): Promise<BookingRequest[]>
  /** Conditional UPDATE on reminder_sent_at IS NULL; true for exactly one caller. */
  claimReminder(id: string, at: Date): Promise<boolean>
}

/** W3 (R19): clears name and notes on bookings dated before `beforeDate`; returns the rows changed. */
export interface BookingRetentionStore {
  purgePii(beforeDate: string, at: Date): Promise<number>
}

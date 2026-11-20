/**
 * BOOK-001: ports the booking use cases depend on. Supabase adapters live in
 * `src/infrastructure/supabase/repositories/booking-*-repository.ts`; tests
 * use in-memory fakes with the same atomicity (first claim wins).
 */
import type {
  AgentBooking,
  DinerBooking,
  BookingDecision,
  BookingRequest,
  DecisionMessageStatus,
  NewAgentBooking,
  NewBookingRequest,
} from '@/domain/entities/booking-request'
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
  /** Every pending request plus the newest `decidedLimit` decided ones, newest first (F10). */
  listForRestaurant(restaurantId: string, decidedLimit: number): Promise<BookingRequest[]>
  /** Staff lookup: never returns an unverified agent booking (R41). */
  findForRestaurant(id: string, restaurantId: string): Promise<BookingRequest | null>
  /** Conditional pending -> decision, scoped by restaurant; null if no row changed (R4, R6). The row carries `replacesBookingId`. */
  decide(args: DecideBookingArgs): Promise<BookingRequest | null>
  /**
   * AGENT-003 R23: confirm a pending CHANGE request and cancel the booking it
   * replaces, in one transaction (RPC confirm_booking_change). Null, nothing
   * changed, when the id is not a pending change request of this restaurant.
   */
  confirmChange(args: Omit<DecideBookingArgs, 'decision' | 'declineReason'>): Promise<BookingRequest | null>
  /** Stores whether the decision message was delivered, scoped by restaurant (F9). */
  recordDecisionMessage(id: string, restaurantId: string, status: DecisionMessageStatus): Promise<void>
}

/** BOOK-007 (R5, R6): staff mark a past confirmed booking as a no-show. */
export interface MarkNoShowArgs {
  id: string
  restaurantId: string
  markedBy: string
  at: Date
  /** Hong Kong now: only a booking before it can be marked. */
  before: HongKongMoment
}

/**
 * BOOK-007: one conditional statement each, scoped by id AND restaurant (R5):
 * mark only confirmed + past + no pending change request replacing it (r1 F1)
 * -> no_show (who/when stored, R6); undo only no_show -> confirmed (both
 * cleared). Null when no row changed.
 */
export interface BookingNoShowStore {
  markNoShow(args: MarkNoShowArgs): Promise<BookingRequest | null>
  undoNoShow(args: { id: string; restaurantId: string }): Promise<BookingRequest | null>
  /** Staff lookup: never returns an unverified agent booking (R41). */
  findForRestaurant(id: string, restaurantId: string): Promise<BookingRequest | null>
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

/**
 * AGENT-003 R20/R24 (review F10): the Hong Kong date and HH:MM now. A booking
 * is upcoming when it is on a later date, or today at this time or later.
 */
export interface HongKongMoment {
  date: string
  time: string
}

export interface CancelDinerBookingArgs {
  restaurantId: string
  phone: string
  id: string
  /** Hong Kong now: only upcoming bookings can be cancelled. */
  from: HongKongMoment
  at: Date
}

/**
 * AGENT-003 R20/R21/R24: a diner's own bookings, every query scoped by the
 * job's restaurant AND phone in its WHERE (authorize by scoped query).
 */
export interface DinerBookingStore {
  /** Upcoming (pending + confirmed, at or after `from`) bookings of this phone at this restaurant, soonest first. */
  listUpcoming(restaurantId: string, phone: string, from: HongKongMoment): Promise<DinerBooking[]>
  /**
   * One conditional UPDATE: the booking (if upcoming, pending or confirmed)
   * and its open change requests -> cancelled by 'diner_ai'. Returns the ids changed.
   */
  cancelByDiner(args: CancelDinerBookingArgs): Promise<string[]>
}

/** W3 (AC-15): confirmed bookings awaiting their one reminder, across restaurants (cron only). */
export interface BookingReminderStore {
  /** Confirmed, not reminded, due at `now` (start window applied by the store), earliest start first. */
  listReminderCandidates(now: Date, limit: number): Promise<BookingRequest[]>
  /** Conditional UPDATE on reminder_sent_at IS NULL; true for exactly one caller. */
  claimReminder(id: string, at: Date): Promise<boolean>
}

/** W3 (R19): clears name and notes on bookings dated before `beforeDate`; returns the rows changed. */
export interface BookingRetentionStore {
  purgePii(beforeDate: string, at: Date): Promise<number>
}

/** BOOK-003 (R41): deletes unverified bookings created before `createdBefore`; returns the rows deleted. */
export interface UnverifiedBookingPurgeStore {
  purgeUnverified(createdBefore: Date): Promise<number>
}

export type InsertAgentBookingResult =
  | { ok: true; booking: AgentBooking }
  | { ok: false; conflict: 'confirm_code' | 'idempotency_key' }

export interface PromoteAgentBookingArgs {
  restaurantId: string
  /** The webhook sender, E.164 (trusted: signed Kapso webhook). */
  phone: string
  codes: string[]
  wamid: string
  at: Date
  /** BOOK-001 R11 (review F1): promote only while the phone holds fewer pending requests here than this. */
  maxPending: number
}

/** BOOK-003: agent bookings (`booking_requests` rows with source 'agent'). */
export interface AgentBookingStore {
  /** One insert, status unverified (R42); a unique-index clash is a conflict, not an error. */
  insert(booking: NewAgentBooking): Promise<InsertAgentBookingResult>
  /** Unverified bookings still inside their 30 minutes; `phone` narrows to one diner (R39). */
  countLiveUnverified(restaurantId: string, now: Date, phone?: string): Promise<number>
  /** BOOK-001 R11 (review F1): pending requests of any source for this phone at this restaurant. */
  countPending(restaurantId: string, phone: string): Promise<number>
  findByIdempotencyKey(restaurantId: string, key: string): Promise<AgentBooking | null>
  /** Any status, scoped by restaurant; for the agent's status read only. */
  find(id: string, restaurantId: string): Promise<AgentBooking | null>
  /** R46: a replay hands out a fresh token; the old one stops working. */
  replaceStatusToken(id: string, restaurantId: string, statusTokenHash: string): Promise<void>
  /**
   * R31/R32: one conditional UPDATE unverified -> pending where the code
   * matches, the phone is the sender's and it has not expired, and (review
   * F1) only while the phone has fewer than `maxPending` pending requests at
   * the restaurant, decided in the same transaction. Returns the rows it
   * changed (none on a replay, any mismatch or a full cap).
   */
  promote(args: PromoteAgentBookingArgs): Promise<BookingRequest[]>
}

export interface AgentBookingTenant {
  restaurantId: string
  config: BookingConfig
}

/** BOOK-003 (R33): the only way the agent API learns its restaurant. */
export interface AgentBookingDirectory {
  findByPublicId(publicId: string): Promise<AgentBookingTenant | null>
}

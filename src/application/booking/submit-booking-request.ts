/**
 * BOOK-001: accept a diner's booking from the booking page (spec AC-10/11).
 *
 * Order matters:
 *  1. per-IP rate limit (R11), before any database read;
 *  2. peek the token, then validate the body: a field error leaves the link
 *     usable so the diner can correct it (AC-11, nothing stored);
 *  3. pending cap per phone (R11);
 *  4. claim the token atomically (R1); only the winner continues;
 *  5. insert the booking for the TOKEN's restaurant and phone (R2), linking
 *     an existing member only (R21);
 *  6. tell the diner, best effort: a send failure never fails the request.
 *
 * BOOK-009: the restaurant's booking hours and terms are part of step 2
 * (`bookingRulesAt`); accepted terms are stored on the booking with the exact
 * text the diner saw (spec AC-10).
 *
 * BOOK-010: when room rules apply (`roomApplies`), step 2 also answers `full`
 * early (counts + stops), and step 5 writes through the atomic
 * check-and-insert; a refusal there gives the token back (spec AC-5, AC-13).
 *
 * BOOK-014 W3 (spec AC-5, AC-6; threat R53, R54, R64): when the restaurant's
 * deposit rule applies to the party, step 5 goes through `startDeposit`
 * instead: the booking is held `awaiting_deposit` with its seats, the diner is
 * redirected to the /p link, and step 6 waits for the paid event
 * (payments/notify-deposit-paid.ts). A provider failure leaves no booking in
 * the seat counts and answers the fixed `payment_unavailable`; the token
 * stays spent (spec Explicitly Not Handled: no retry from the same link).
 */
import { hasPhone, MAX_PENDING_PER_PHONE, type BookingRequest, type NewBookingRequest } from '@/domain/entities/booking-request'
import {
  hongKongTime,
  hongKongToday,
  parseBookingSubmission,
  type BookingFieldErrors,
  type BookingSubmission,
  type BookingSubmissionRules,
} from '@/domain/services/booking-submission'
import type { BookingTokenState } from '@/domain/services/booking-token'
import { activeSchedule, termsRequired, termsSnapshot } from '@/domain/value-objects/booking-hours'
import type { BookingConfig } from '@/domain/value-objects/booking-config'
import type { RateLimiterPort } from '@/domain/ports/rate-limiter'
import { roomApplies } from '@/domain/services/booking-room'
import type { SuggestedTime } from '@/domain/services/booking-hours'
import { earlyFull, fittingSuggestions, insertWithRoom, type FullRefusal, type RoomContext } from './booking-room-check'
import { startDeposit, type StartDepositDeps } from '@/application/payments/start-deposit'
import { roomCheckFor, type RoomCheck, type RoomRefusal } from '@/domain/services/booking-room'
import type { DepositBookingWriter, MerchantPaymentAccountReader } from '@/domain/ports/booking-deposit'
import type { DepositRule } from '@/domain/value-objects/deposit-rule'
import type {
  BookingMemberLookup,
  BookingMessageSender,
  BookingRequestStore,
  BookingRoomStore,
  BookingSettingsReader,
  BookingTokenOwner,
  BookingTokenStore,
} from '@/domain/ports/booking'

export const SUBMIT_LIMIT_PER_MINUTE = 10

export interface SubmitBookingDeps {
  tokens: BookingTokenStore
  requests: BookingRequestStore
  settings: BookingSettingsReader
  members: BookingMemberLookup
  sender: BookingMessageSender
  limiter: RateLimiterPort
  now(): Date
  /** BOOK-010: guest counts, stops and the atomic insert; absent = no room check (BOOK-001..009 callers). */
  room?: BookingRoomStore
  /** BOOK-014 W3: the deposit path; absent = never a deposit (BOOK-001..013 callers). */
  deposit?: SubmitDepositDeps
}

export interface SubmitDepositDeps {
  accounts: MerchantPaymentAccountReader
  writer: DepositBookingWriter
  start: StartDepositDeps
}

export type SubmitBookingResult =
  | { ok: true; bookingId: string; delivered: boolean }
  /** BOOK-014 W3: held awaiting_deposit; the diner goes to the /p link (spec AC-5). */
  | { ok: true; bookingId: string; redirect: string }
  /** BOOK-014 R54/R64: the provider failed; no booking holds seats. */
  | { ok: false; reason: 'payment_unavailable' }
  | { ok: false; reason: 'rate_limited' }
  | { ok: false; reason: 'token_unusable'; state: BookingTokenState }
  | { ok: false; reason: 'booking_unavailable' }
  | { ok: false; reason: 'invalid'; errors: BookingFieldErrors; suggestedTimes?: SuggestedTime[] }
  | { ok: false; reason: 'too_many_pending' }
  | { ok: false; reason: 'failed' }

const maskPhone = (phone: string) => `***${phone.slice(-4)}`

/** Fails open on a limiter outage: the token and the pending cap still bound abuse. */
async function withinRateLimit(limiter: RateLimiterPort, clientIp: string): Promise<boolean> {
  try {
    const { allowed } = await limiter.incrWindow(`book001:submit:${clientIp}`, SUBMIT_LIMIT_PER_MINUTE, 60)
    return allowed
  } catch (err) {
    console.warn('[Booking] rate limiter unavailable, allowing:', (err as Error).name)
    return true
  }
}

async function claimOrState(deps: SubmitBookingDeps, token: string, at: Date) {
  const owner = await deps.tokens.claim(token, at)
  if (owner) return { owner }
  const { state } = await deps.tokens.peek(token, deps.now())
  return { state: state === 'valid' ? ('consumed' as const) : state }
}

/** BOOK-009 AC-10: when, and the exact text, of terms the diner accepted. */
function termsAcceptance(s: BookingSubmission, config: BookingConfig, at: Date) {
  const text = s.termsAccepted ? termsSnapshot(config.bookingHours) : null
  return text ? { termsAcceptedAt: at.toISOString(), termsText: text } : {}
}

/** BOOK-010: the room context when room rules apply and a room store is wired; else null (BOOK-009 path). */
function roomContext(deps: SubmitBookingDeps, restaurantId: string, config: BookingConfig): (RoomContext & { store: BookingRoomStore }) | null {
  if (!deps.room || !roomApplies(config.bookingHours)) return null
  const now = deps.now()
  return { restaurantId, hours: config.bookingHours, clock: { today: hongKongToday(now), nowTime: hongKongTime(now) }, store: deps.room }
}

const fullResult = (full: FullRefusal): SubmitBookingResult => ({
  ok: false, reason: 'invalid', errors: full.errors, suggestedTimes: full.suggestedTimes,
})

type StoreOutcome =
  | { kind: 'booked'; booking: BookingRequest }
  | { kind: 'deposit'; booking: BookingRequest; redirect: string }
  | { kind: 'full'; full: FullRefusal }
  | { kind: 'too_many_pending' }
  | { kind: 'payment_unavailable' }
  | { kind: 'failed' }

type StoreClaim = { token: string; owner: BookingTokenOwner; claimedAt: Date; config: BookingConfig }

/** No guest limits: the atomic insert then checks only the per-phone cap (no booking hours set). */
const NO_ROOM_LIMITS: RoomCheck = { periodKey: null, periodFirst: null, periodLast: null, perSlot: null, perMeal: null }

/** BOOK-014: whether the rule could apply to this party at all (skips the account read when it cannot). */
const depositMayApply = (rule: DepositRule, partySize: number) => rule.enabled && partySize >= rule.fromPartySize

/** BOOK-010 refusal from the deposit insert, as `insertWithRoom` words it (suggestions only with room rules). */
async function fullFromRefusal(room: (RoomContext & { store: BookingRoomStore }) | null, request: NewBookingRequest, refusal: RoomRefusal): Promise<FullRefusal> {
  const req = { date: request.bookingDate, time: request.bookingTime, partySize: request.partySize }
  return { errors: { time: 'full' }, suggestedTimes: room ? await fittingSuggestions(room.store, room, req) : [], refusal }
}

/** BOOK-014 W3: the deposit path, or null when no deposit applies (the caller books the BOOK-001 way). */
async function storeWithDeposit(
  deps: Pick<SubmitBookingDeps, 'settings'> & { deposit: SubmitDepositDeps },
  claim: StoreClaim,
  request: NewBookingRequest,
  room: (RoomContext & { store: BookingRoomStore }) | null
): Promise<StoreOutcome | null> {
  const rule = claim.config.deposit
  if (!depositMayApply(rule, request.partySize)) return null
  const { accounts, writer, start } = deps.deposit
  const [account, restaurant] = await Promise.all([accounts.findForRestaurant(request.restaurantId), deps.settings.getRestaurant(request.restaurantId)])
  const check = room ? roomCheckFor(room.hours, request.bookingDate, request.bookingTime) : NO_ROOM_LIMITS
  const started = await startDeposit(start, {
    restaurantId: request.restaurantId,
    rule,
    account,
    partySize: request.partySize,
    holder: 'diner',
    restaurantName: restaurant?.name ?? '',
    bookingDate: request.bookingDate,
    bookingTime: request.bookingTime,
    // R55: the seat check and the per-phone cap in the same transaction as the hold.
    insertBooking: (hold) => writer.insertWithDeposit(request, check, hold, MAX_PENDING_PER_PHONE),
  })
  switch (started.kind) {
    case 'not_required':
      return null
    case 'started':
      return { kind: 'deposit', booking: started.booking, redirect: started.paymentUrl }
    case 'payment_unavailable':
      return { kind: 'payment_unavailable' }
    case 'refused':
      return started.refusal.kind === 'pending_cap'
        ? { kind: 'too_many_pending' }
        : { kind: 'full', full: await fullFromRefusal(room, request, started.refusal) }
  }
}

async function store(deps: SubmitBookingDeps, claim: StoreClaim, s: BookingSubmission): Promise<StoreOutcome> {
  const { token, owner, claimedAt } = claim
  try {
    const memberId = await deps.members.findMemberId(owner.restaurantId, owner.phone)
    const request: NewBookingRequest = {
      restaurantId: owner.restaurantId, memberId, phone: owner.phone, name: s.name, partySize: s.partySize,
      bookingDate: s.date, bookingTime: s.time, notes: s.notes, source: owner.source, campaignId: owner.campaignId, token,
      ...termsAcceptance(s, claim.config, claimedAt),
    }
    const room = roomContext(deps, owner.restaurantId, claim.config)
    const held = deps.deposit ? await storeWithDeposit({ settings: deps.settings, deposit: deps.deposit }, claim, request, room) : null
    if (held) {
      if (held.kind === 'full' || held.kind === 'too_many_pending') await deps.tokens.release(token, claimedAt)
      return held
    }
    if (!room) return { kind: 'booked', booking: await deps.requests.insert(request) }
    const inserted = await insertWithRoom(room.store, room, request)
    if (inserted.ok) return { kind: 'booked', booking: inserted.booking }
    await deps.tokens.release(token, claimedAt)
    return { kind: 'full', full: inserted.full }
  } catch (err) {
    console.error('[Booking] insert failed:', { to: maskPhone(owner.phone), error: (err as Error).message })
    await deps.tokens.release(token, claimedAt)
    return { kind: 'failed' }
  }
}

/** What `bookingRulesAt` needs from a restaurant's booking config. */
export type BookingRulesConfig = Pick<BookingConfig, 'maxPartySize' | 'bookingHours'>

/**
 * BOOK-001 rules for a submission made now (Hong Kong today and time, the
 * tenant's party cap). Shared with AGENT-003 and BOOK-003.
 * BOOK-009: given the config, also its booking hours and whether its terms
 * must be accepted. A bare party cap (callers not yet passing the config)
 * keeps the BOOK-001 rules only.
 * F1 (P2-1): the slot rules only while the schedule switch is on; the terms either way.
 */
export function bookingRulesAt(now: Date, config: number | BookingRulesConfig): BookingSubmissionRules {
  const base = { today: hongKongToday(now), nowTime: hongKongTime(now) }
  if (typeof config === 'number') return { ...base, maxPartySize: config }
  const hours = config.bookingHours
  return { ...base, maxPartySize: config.maxPartySize, hours: activeSchedule(hours), termsRequired: termsRequired(hours) }
}

/** The diner's "received" message, best effort (shared with AGENT-003 R16). */
export async function notifyReceived(
  deps: { settings: Pick<BookingSettingsReader, 'getRestaurant'>; sender: BookingMessageSender },
  booking: BookingRequest
): Promise<boolean> {
  // BOOK-013 R19: never reached by a diner channel (the DB requires their phone); no phone, no send.
  if (!hasPhone(booking)) return false
  const restaurant = await deps.settings.getRestaurant(booking.restaurantId)
  const result = await deps.sender.send({
    restaurantId: booking.restaurantId, phone: booking.phone, memberId: booking.memberId, kind: 'received',
    details: { restaurantName: restaurant?.name ?? '', name: booking.name, date: booking.bookingDate, time: booking.bookingTime, partySize: booking.partySize },
  })
  return result.delivered
}

export async function submitBookingRequest(
  deps: SubmitBookingDeps,
  input: { token: string; body: unknown; clientIp: string }
): Promise<SubmitBookingResult> {
  if (!(await withinRateLimit(deps.limiter, input.clientIp))) return { ok: false, reason: 'rate_limited' }

  const peeked = await deps.tokens.peek(input.token, deps.now())
  if (peeked.state !== 'valid' || !peeked.owner) return { ok: false, reason: 'token_unusable', state: peeked.state }
  const config = await deps.settings.getConfig(peeked.owner.restaurantId)
  if (config.mode !== 'simple') return { ok: false, reason: 'booking_unavailable' }

  const result = parseBookingSubmission(input.body, bookingRulesAt(deps.now(), config))
  if (!result.ok) return { ok: false, reason: 'invalid', errors: result.errors }
  const room = roomContext(deps, peeked.owner.restaurantId, config)
  const s = result.submission
  const early = room ? await earlyFull(room.store, room, { date: s.date, time: s.time, partySize: s.partySize }) : null
  if (early) return fullResult(early)
  if ((await deps.requests.countPending(peeked.owner.restaurantId, peeked.owner.phone)) >= MAX_PENDING_PER_PHONE) {
    return { ok: false, reason: 'too_many_pending' }
  }

  const claimedAt = deps.now()
  const claim = await claimOrState(deps, input.token, claimedAt)
  if (!claim.owner) return { ok: false, reason: 'token_unusable', state: claim.state }
  const stored = await store(deps, { token: input.token, owner: claim.owner, claimedAt, config }, result.submission)
  switch (stored.kind) {
    case 'booked':
      return { ok: true, bookingId: stored.booking.id, delivered: await notifyReceived(deps, stored.booking) }
    case 'deposit':
      // Spec AC-6: the "received" message waits for the paid event.
      return { ok: true, bookingId: stored.booking.id, redirect: stored.redirect }
    case 'full':
      return fullResult(stored.full)
    case 'too_many_pending':
    case 'payment_unavailable':
    case 'failed':
      return { ok: false, reason: stored.kind }
  }
}

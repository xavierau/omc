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
 */
import { MAX_PENDING_PER_PHONE, type BookingRequest } from '@/domain/entities/booking-request'
import {
  hongKongToday,
  parseBookingSubmission,
  type BookingFieldErrors,
  type BookingSubmission,
} from '@/domain/services/booking-submission'
import type { BookingTokenState } from '@/domain/services/booking-token'
import type { RateLimiterPort } from '@/domain/ports/rate-limiter'
import type {
  BookingMemberLookup,
  BookingMessageSender,
  BookingRequestStore,
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
}

export type SubmitBookingResult =
  | { ok: true; bookingId: string; delivered: boolean }
  | { ok: false; reason: 'rate_limited' }
  | { ok: false; reason: 'token_unusable'; state: BookingTokenState }
  | { ok: false; reason: 'booking_unavailable' }
  | { ok: false; reason: 'invalid'; errors: BookingFieldErrors }
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

async function store(
  deps: SubmitBookingDeps,
  claim: { token: string; owner: BookingTokenOwner; claimedAt: Date },
  s: BookingSubmission
): Promise<BookingRequest | null> {
  const { token, owner, claimedAt } = claim
  try {
    const memberId = await deps.members.findMemberId(owner.restaurantId, owner.phone)
    return await deps.requests.insert({
      restaurantId: owner.restaurantId, memberId, phone: owner.phone, name: s.name, partySize: s.partySize,
      bookingDate: s.date, bookingTime: s.time, notes: s.notes, source: owner.source, campaignId: owner.campaignId, token,
    })
  } catch (err) {
    console.error('[Booking] insert failed:', { to: maskPhone(owner.phone), error: (err as Error).message })
    await deps.tokens.release(token, claimedAt)
    return null
  }
}

async function notifyReceived(deps: SubmitBookingDeps, booking: BookingRequest): Promise<boolean> {
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

  const result = parseBookingSubmission(input.body, { today: hongKongToday(deps.now()), maxPartySize: config.maxPartySize })
  if (!result.ok) return { ok: false, reason: 'invalid', errors: result.errors }
  if ((await deps.requests.countPending(peeked.owner.restaurantId, peeked.owner.phone)) >= MAX_PENDING_PER_PHONE) {
    return { ok: false, reason: 'too_many_pending' }
  }

  const claimedAt = deps.now()
  const claim = await claimOrState(deps, input.token, claimedAt)
  if (!claim.owner) return { ok: false, reason: 'token_unusable', state: claim.state }
  const booking = await store(deps, { token: input.token, owner: claim.owner, claimedAt }, result.submission)
  if (!booking) return { ok: false, reason: 'failed' }
  return { ok: true, bookingId: booking.id, delivered: await notifyReceived(deps, booking) }
}

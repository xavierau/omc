/**
 * BOOK-003: a personal agent requests a table (PAP 1.0, signed out).
 *
 * Order matters:
 *  1. per-IP rate limit (R39), before any database read;
 *  2. the restaurant from the agent booking id only (R33, R43);
 *  3. the body, strictly (R34), and the Idempotency-Key shape;
 *  4. an Idempotency-Key replay returns the same booking with a fresh status
 *     token; another body under the same key is a conflict (R46);
 *  5. live-unverified caps per phone and per restaurant (R39), and BOOK-001's
 *     R11 cap: live unverified + pending for the phone at the restaurant
 *     (review F1; promotion re-checks it atomically, verify-agent-booking);
 *  6. at most 5 creates per client IP per restaurant per 30 minutes (R39, review
 *     G1), so one IP cannot fill the restaurant-wide safety cap. Counted only
 *     for a request about to insert: replays, invalid bodies and capped
 *     requests do not use it up. The IP lives in the limiter key only, never
 *     in Postgres;
 *  7. ONE insert, status unverified, with a fresh confirm code and the hash of
 *     a fresh status token (R31, R36, R42). Nothing is sent on WhatsApp and no
 *     member or consent row is touched: the diner has not proved the phone.
 *
 * Logs carry the error class and the booking id only (R37).
 *
 * BOOK-009 W4: a slot the booking hours refuse answers with up to 3
 * `suggestedTimes` (spec AC-12); accepted terms are stored on the row with
 * the exact text, when it is created (spec AC-13, W1 snapshot rule).
 *
 * BOOK-010 (spec AC-4): a slot that cannot take the party now (limits or
 * stops) answers `time: full` with suggestions that fit; nothing is written.
 * The row is unverified and holds no seats; the code step re-checks room
 * atomically (verify-agent-booking, spec AC-6).
 */
import {
  AGENT_CREATES_PER_IP_WINDOW_SEC,
  AGENT_VERIFY_TTL_MS,
  MAX_AGENT_CREATES_PER_IP_PER_RESTAURANT,
  MAX_PENDING_PER_PHONE,
  MAX_UNVERIFIED_PER_PHONE,
  MAX_UNVERIFIED_PER_RESTAURANT,
  type AgentBooking,
} from '@/domain/entities/booking-request'
import {
  IDEMPOTENCY_WINDOW_MS,
  agentBookingStatus,
  agentBookingStatusView,
  hasConfirmableWhatsAppNumber,
  isSameAgentSubmission,
  isHoursRefusal,
  isValidIdempotencyKey,
  parseAgentBookingBody,
  suggestionsForRefusal,
  type AgentBookingStatus,
  type AgentBookingStatusView,
  type AgentBookingSubmission,
} from '@/domain/services/agent-booking'
import type { BookingFieldErrors } from '@/domain/services/booking-submission'
import type { SuggestedTime } from '@/domain/services/booking-hours'
import { termsSnapshot } from '@/domain/value-objects/booking-hours'
import { generateConfirmCode } from '@/domain/services/booking-confirm-code'
import { buildCollectionStatement, buildConfirmText, type CollectionStatement } from '@/domain/services/poppy-documents'
import { buildContactUrl } from '@/domain/services/contact-redirect'
import type { RateLimiterPort } from '@/domain/ports/rate-limiter'
import type {
  AgentBookingDirectory,
  AgentBookingStore,
  AgentBookingTenant,
  BookingRestaurantContext,
  BookingSettingsReader,
} from '@/domain/ports/booking'
import { hashStatusToken, type AgentBookingSecrets } from './agent-booking-secrets'
import { resolveAgentBookingTenant } from './resolve-agent-booking-tenant'
import { roomApplies } from '@/domain/services/booking-room'
import { hongKongTime, hongKongToday } from '@/domain/services/booking-submission'
import type { BookingRoomReader } from '@/domain/ports/booking'
import { earlyFull, suggestionFits, suggestionParty } from './booking-room-check'
import { bookingRulesAt, type BookingRulesConfig } from './submit-booking-request'

export const AGENT_SUBMIT_LIMIT_PER_MINUTE = 10
export const IP_RETRY_AFTER_SEC = 60
/** A cap frees up when the oldest live request expires; at most 30 minutes. */
export const CAP_RETRY_AFTER_SEC = 600
const INSERT_ATTEMPTS = 3

export interface CreateAgentBookingDeps {
  directory: AgentBookingDirectory
  store: AgentBookingStore
  settings: Pick<BookingSettingsReader, 'getRestaurant'>
  limiter: RateLimiterPort
  secrets: AgentBookingSecrets
  privacyUrl: string
  now(): Date
  /** BOOK-010: guest counts and stops; absent = no room check. */
  room?: BookingRoomReader
}

export interface CreateAgentBookingInput {
  publicId: string
  body: unknown
  clientIp: string
  idempotencyKey: string | null
}

export interface AwaitingConfirmationBody {
  booking_id: string
  status: 'awaiting_confirmation'
  confirm_url: string
  confirm_code: string
  expires_at: string
  status_token: string
  collection_statement: CollectionStatement
}

export type ReplayedStatusBody = AgentBookingStatusView & { status_token: string; collection_statement: CollectionStatement }

export type CreateAgentBookingResult =
  | { ok: true; kind: 'awaiting_confirmation'; body: AwaitingConfirmationBody }
  | { ok: true; kind: 'replayed_status'; body: ReplayedStatusBody }
  | { ok: false; reason: 'rate_limited'; retryAfterSec: number }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'invalid'; errors: BookingFieldErrors; suggestedTimes?: SuggestedTime[] }
  | { ok: false; reason: 'idempotency_conflict'; description: string }
  | { ok: false; reason: 'failed' }

/**
 * R39: the per-IP limit every agent API call shares (POST /bookings and,
 * BOOK-009 threat R2, GET /availability), before any database read.
 */
export function withinAgentIpLimit(limiter: RateLimiterPort, clientIp: string): Promise<boolean> {
  return withinWindow(limiter, `book003:agent:${clientIp}`, AGENT_SUBMIT_LIMIT_PER_MINUTE, 60)
}

/** The per-IP-per-restaurant window is fixed, so the wait is at most one full window. */
export const IP_RESTAURANT_RETRY_AFTER_SEC = AGENT_CREATES_PER_IP_WINDOW_SEC

/** Fails open on a limiter outage, as BOOK-001: the caps and the WhatsApp proof still bound abuse. */
async function withinWindow(limiter: RateLimiterPort, key: string, limit: number, windowSec: number): Promise<boolean> {
  try {
    const { allowed } = await limiter.incrWindow(key, limit, windowSec)
    return allowed
  } catch (err) {
    console.warn('[AgentBooking] rate limiter unavailable, allowing:', (err as Error).name)
    return true
  }
}

interface Context {
  deps: CreateAgentBookingDeps
  restaurantId: string
  config: BookingRulesConfig
  restaurant: BookingRestaurantContext & { whatsappNumber: string }
  statement: CollectionStatement
  now: Date
}

function awaitingBody(ctx: Context, booking: AgentBooking, statusToken: string): AwaitingConfirmationBody | null {
  const code = booking.confirmCode
  const url = code ? buildContactUrl(ctx.restaurant.whatsappNumber, buildConfirmText(ctx.restaurant.name, code)) : null
  if (!code || !url || !booking.verifyExpiresAt) return null
  return {
    booking_id: booking.id,
    status: 'awaiting_confirmation',
    confirm_url: url,
    confirm_code: code,
    expires_at: booking.verifyExpiresAt,
    status_token: statusToken,
    collection_statement: ctx.statement,
  }
}

async function replay(ctx: Context, booking: AgentBooking): Promise<CreateAgentBookingResult> {
  const statusToken = ctx.deps.secrets.statusToken()
  await ctx.deps.store.replaceStatusToken(booking.id, ctx.restaurantId, hashStatusToken(statusToken))
  const status: AgentBookingStatus = agentBookingStatus(booking.status, booking.verifyExpiresAt, ctx.now)
  const awaiting = status === 'awaiting_confirmation' ? awaitingBody(ctx, booking, statusToken) : null
  if (awaiting) return { ok: true, kind: 'awaiting_confirmation', body: awaiting }
  return {
    ok: true,
    kind: 'replayed_status',
    body: { ...agentBookingStatusView(booking, ctx.now), status_token: statusToken, collection_statement: ctx.statement },
  }
}

async function replayIfKnown(ctx: Context, key: string, s: AgentBookingSubmission): Promise<CreateAgentBookingResult | null> {
  const existing = await ctx.deps.store.findByIdempotencyKey(ctx.restaurantId, key)
  if (!existing) return null
  if (ctx.now.getTime() - Date.parse(existing.createdAt) > IDEMPOTENCY_WINDOW_MS) {
    return { ok: false, reason: 'idempotency_conflict', description: 'This Idempotency-Key was used more than 24 hours ago. Send a new key.' }
  }
  if (!isSameAgentSubmission(existing, s)) {
    return { ok: false, reason: 'idempotency_conflict', description: 'This Idempotency-Key was used with a different request body.' }
  }
  return replay(ctx, existing)
}

async function overCap(ctx: Context, phone: string): Promise<boolean> {
  const { store } = ctx.deps
  const unverified = await store.countLiveUnverified(ctx.restaurantId, ctx.now, phone)
  if (unverified >= MAX_UNVERIFIED_PER_PHONE) return true
  if (unverified + (await store.countPending(ctx.restaurantId, phone)) >= MAX_PENDING_PER_PHONE) return true
  return (await store.countLiveUnverified(ctx.restaurantId, ctx.now)) >= MAX_UNVERIFIED_PER_RESTAURANT
}

function withinIpRestaurantWindow(ctx: Context, clientIp: string): Promise<boolean> {
  const key = `book003:agent-restaurant:${ctx.restaurantId}:${clientIp}`
  return withinWindow(ctx.deps.limiter, key, MAX_AGENT_CREATES_PER_IP_PER_RESTAURANT, AGENT_CREATES_PER_IP_WINDOW_SEC)
}

/** BOOK-009 AC-13: when, and the exact text, of terms the diner accepted through the agent. */
function termsAcceptance(ctx: Context, s: AgentBookingSubmission) {
  const text = s.termsAccepted ? termsSnapshot(ctx.config.bookingHours) : null
  return text ? { termsAcceptedAt: ctx.now.toISOString(), termsText: text } : {}
}

async function insert(ctx: Context, s: AgentBookingSubmission, key: string | null): Promise<CreateAgentBookingResult> {
  const { deps } = ctx
  const verifyExpiresAt = new Date(ctx.now.getTime() + AGENT_VERIFY_TTL_MS).toISOString()
  for (let attempt = 0; attempt < INSERT_ATTEMPTS; attempt++) {
    const statusToken = deps.secrets.statusToken()
    const result = await deps.store.insert({
      restaurantId: ctx.restaurantId, phone: s.phone, name: s.name, partySize: s.partySize, bookingDate: s.date,
      bookingTime: s.time, notes: s.notes, confirmCode: generateConfirmCode(deps.secrets.randomIndex), verifyExpiresAt,
      statusTokenHash: hashStatusToken(statusToken), idempotencyKey: key, ...termsAcceptance(ctx, s),
    })
    if (result.ok) {
      const body = awaitingBody(ctx, result.booking, statusToken)
      return body ? { ok: true, kind: 'awaiting_confirmation', body } : { ok: false, reason: 'failed' }
    }
    // Two requests raced on one key: the loser answers as the replay it is.
    if (result.conflict === 'idempotency_key' && key) return (await replayIfKnown(ctx, key, s)) ?? { ok: false, reason: 'failed' }
  }
  return { ok: false, reason: 'failed' }
}

async function contextFor(deps: CreateAgentBookingDeps, tenant: AgentBookingTenant): Promise<Context | null> {
  const restaurant = await deps.settings.getRestaurant(tenant.restaurantId)
  // Without a WhatsApp number the diner cannot confirm, so the restaurant cannot take agent bookings.
  const whatsappNumber = restaurant?.whatsappNumber
  if (!restaurant || !hasConfirmableWhatsAppNumber(whatsappNumber)) return null
  return {
    deps,
    restaurantId: tenant.restaurantId,
    config: tenant.config,
    restaurant: { ...restaurant, whatsappNumber },
    statement: buildCollectionStatement(restaurant.name, deps.privacyUrl),
    now: deps.now(),
  }
}

/** BOOK-010 (spec AC-4): `full` + suggestions when the party does not fit now; null when it does or room rules do not apply. */
async function fullCheck(ctx: Context, s: AgentBookingSubmission): Promise<CreateAgentBookingResult | null> {
  const hours = ctx.config.bookingHours
  if (!ctx.deps.room || !roomApplies(hours)) return null
  const clock = { today: hongKongToday(ctx.now), nowTime: hongKongTime(ctx.now) }
  const full = await earlyFull(ctx.deps.room, { restaurantId: ctx.restaurantId, hours, clock }, { date: s.date, time: s.time, partySize: s.partySize })
  return full ? { ok: false, reason: 'invalid', errors: full.errors, suggestedTimes: full.suggestedTimes } : null
}

/** BOOK-010 F1 (review P2-1): alternatives to a slot the hours refuse fit the party too, when room rules apply. */
async function refusalFits(ctx: Context, errors: BookingFieldErrors, b: Record<string, unknown>) {
  const hours = ctx.config.bookingHours
  if (!ctx.deps.room || !roomApplies(hours) || !isHoursRefusal(errors)) return undefined
  const clock = { today: hongKongToday(ctx.now), nowTime: hongKongTime(ctx.now) }
  return suggestionFits(ctx.deps.room, { restaurantId: ctx.restaurantId, hours, clock }, { date: String(b.date), partySize: suggestionParty(b.party_size) })
}

/** BOOK-009: the tenant's booking hours and terms bind agents too (`bookingRulesAt`, spec AC-12/13). */
async function parseInput(ctx: Context, input: CreateAgentBookingInput) {
  const rules = bookingRulesAt(ctx.now, ctx.config)
  const parsed = parseAgentBookingBody(input.body, rules)
  const keyError = input.idempotencyKey !== null && !isValidIdempotencyKey(input.idempotencyKey)
  if (!parsed.ok || keyError) {
    const errors = { ...(parsed.ok ? {} : parsed.errors), ...(keyError ? { 'Idempotency-Key': 'invalid' } : {}) }
    const b = (input.body ?? {}) as Record<string, unknown>
    const fits = await refusalFits(ctx, errors, b)
    const suggested = suggestionsForRefusal(rules.hours, errors, { date: String(b.date), time: String(b.time), clock: rules, fits })
    return { ok: false as const, errors, ...(suggested ? { suggestedTimes: suggested } : {}) }
  }
  return parsed
}

export async function createAgentBooking(
  deps: CreateAgentBookingDeps,
  input: CreateAgentBookingInput
): Promise<CreateAgentBookingResult> {
  if (!(await withinAgentIpLimit(deps.limiter, input.clientIp))) return { ok: false, reason: 'rate_limited', retryAfterSec: IP_RETRY_AFTER_SEC }
  const tenant = await resolveAgentBookingTenant(deps.directory, input.publicId)
  const ctx = tenant ? await contextFor(deps, tenant) : null
  if (!tenant || !ctx) return { ok: false, reason: 'not_found' }

  try {
    const parsed = await parseInput(ctx, input)
    if (!parsed.ok) return { ok: false, reason: 'invalid', errors: parsed.errors, ...('suggestedTimes' in parsed ? { suggestedTimes: parsed.suggestedTimes } : {}) }
    const s = parsed.submission
    if (input.idempotencyKey) {
      const replayed = await replayIfKnown(ctx, input.idempotencyKey, s)
      if (replayed) return replayed
    }
    const full = await fullCheck(ctx, s)
    if (full) return full
    if (await overCap(ctx, s.phone)) return { ok: false, reason: 'rate_limited', retryAfterSec: CAP_RETRY_AFTER_SEC }
    if (!(await withinIpRestaurantWindow(ctx, input.clientIp))) {
      return { ok: false, reason: 'rate_limited', retryAfterSec: IP_RESTAURANT_RETRY_AFTER_SEC }
    }
    return await insert(ctx, s, input.idempotencyKey)
  } catch (err) {
    console.error('[AgentBooking] create failed:', { error: (err as Error).name })
    return { ok: false, reason: 'failed' }
  }
}

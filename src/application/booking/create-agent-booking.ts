/**
 * BOOK-003: a personal agent requests a table (PAP 1.0, signed out).
 *
 * Order matters:
 *  1. per-IP rate limit (R39), before any database read;
 *  2. the restaurant from the agent booking id only (R33, R43);
 *  3. the body, strictly (R34), and the Idempotency-Key shape;
 *  4. an Idempotency-Key replay returns the same booking with a fresh status
 *     token; another body under the same key is a conflict (R46);
 *  5. live-unverified caps per phone and per restaurant (R39);
 *  6. ONE insert, status unverified, with a fresh confirm code and the hash of
 *     a fresh status token (R31, R36, R42). Nothing is sent on WhatsApp and no
 *     member or consent row is touched: the diner has not proved the phone.
 *
 * Logs carry the error class and the booking id only (R37).
 */
import {
  AGENT_VERIFY_TTL_MS,
  MAX_UNVERIFIED_PER_PHONE,
  MAX_UNVERIFIED_PER_RESTAURANT,
  type AgentBooking,
} from '@/domain/entities/booking-request'
import {
  IDEMPOTENCY_WINDOW_MS,
  agentBookingStatus,
  agentBookingStatusView,
  isSameAgentSubmission,
  isValidIdempotencyKey,
  parseAgentBookingBody,
  type AgentBookingStatus,
  type AgentBookingStatusView,
  type AgentBookingSubmission,
} from '@/domain/services/agent-booking'
import { hongKongTime, hongKongToday, type BookingFieldErrors } from '@/domain/services/booking-submission'
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
  | { ok: false; reason: 'invalid'; errors: BookingFieldErrors }
  | { ok: false; reason: 'idempotency_conflict'; description: string }
  | { ok: false; reason: 'failed' }

/** Fails open on a limiter outage, as BOOK-001: the caps and the WhatsApp proof still bound abuse. */
async function withinRateLimit(limiter: RateLimiterPort, clientIp: string): Promise<boolean> {
  try {
    const { allowed } = await limiter.incrWindow(`book003:agent:${clientIp}`, AGENT_SUBMIT_LIMIT_PER_MINUTE, 60)
    return allowed
  } catch (err) {
    console.warn('[AgentBooking] rate limiter unavailable, allowing:', (err as Error).name)
    return true
  }
}

interface Context {
  deps: CreateAgentBookingDeps
  restaurantId: string
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
  if ((await store.countLiveUnverified(ctx.restaurantId, ctx.now, phone)) >= MAX_UNVERIFIED_PER_PHONE) return true
  return (await store.countLiveUnverified(ctx.restaurantId, ctx.now)) >= MAX_UNVERIFIED_PER_RESTAURANT
}

async function insert(ctx: Context, s: AgentBookingSubmission, key: string | null): Promise<CreateAgentBookingResult> {
  const { deps } = ctx
  const verifyExpiresAt = new Date(ctx.now.getTime() + AGENT_VERIFY_TTL_MS).toISOString()
  for (let attempt = 0; attempt < INSERT_ATTEMPTS; attempt++) {
    const statusToken = deps.secrets.statusToken()
    const result = await deps.store.insert({
      restaurantId: ctx.restaurantId, phone: s.phone, name: s.name, partySize: s.partySize, bookingDate: s.date,
      bookingTime: s.time, notes: s.notes, confirmCode: generateConfirmCode(deps.secrets.randomIndex), verifyExpiresAt,
      statusTokenHash: hashStatusToken(statusToken), idempotencyKey: key,
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
  if (!restaurant?.whatsappNumber || !buildContactUrl(restaurant.whatsappNumber)) return null
  return {
    deps,
    restaurantId: tenant.restaurantId,
    restaurant: { ...restaurant, whatsappNumber: restaurant.whatsappNumber },
    statement: buildCollectionStatement(restaurant.name, deps.privacyUrl),
    now: deps.now(),
  }
}

function parseInput(ctx: Context, input: CreateAgentBookingInput, maxPartySize: number) {
  const rules = { today: hongKongToday(ctx.now), nowTime: hongKongTime(ctx.now), maxPartySize }
  const parsed = parseAgentBookingBody(input.body, rules)
  const keyError = input.idempotencyKey !== null && !isValidIdempotencyKey(input.idempotencyKey)
  if (!parsed.ok || keyError) {
    const errors = { ...(parsed.ok ? {} : parsed.errors), ...(keyError ? { 'Idempotency-Key': 'invalid' } : {}) }
    return { ok: false as const, errors }
  }
  return parsed
}

export async function createAgentBooking(
  deps: CreateAgentBookingDeps,
  input: CreateAgentBookingInput
): Promise<CreateAgentBookingResult> {
  if (!(await withinRateLimit(deps.limiter, input.clientIp))) return { ok: false, reason: 'rate_limited', retryAfterSec: IP_RETRY_AFTER_SEC }
  const tenant = await resolveAgentBookingTenant(deps.directory, input.publicId)
  const ctx = tenant ? await contextFor(deps, tenant) : null
  if (!tenant || !ctx) return { ok: false, reason: 'not_found' }

  const parsed = parseInput(ctx, input, tenant.config.maxPartySize)
  if (!parsed.ok) return { ok: false, reason: 'invalid', errors: parsed.errors }
  const s = parsed.submission
  try {
    if (input.idempotencyKey) {
      const replayed = await replayIfKnown(ctx, input.idempotencyKey, s)
      if (replayed) return replayed
    }
    if (await overCap(ctx, s.phone)) return { ok: false, reason: 'rate_limited', retryAfterSec: CAP_RETRY_AFTER_SEC }
    return await insert(ctx, s, input.idempotencyKey)
  } catch (err) {
    console.error('[AgentBooking] create failed:', { error: (err as Error).name })
    return { ok: false, reason: 'failed' }
  }
}

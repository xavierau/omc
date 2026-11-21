/**
 * BOOK-009 W4 (spec AC-11, AC-14, threat R2): a personal agent reads which
 * dates are open and which times the restaurant takes, before it books.
 *
 * Signed out, like POST /bookings: the same per-IP limit first (before any
 * database read), then the same agent-booking-id gate (404), then the query
 * (400). Times come from W1's `slotsFor`, the same rule check every channel
 * uses; without booking hours every date is open at any time (`times: null`).
 * The answer holds restaurant settings only, never PII.
 *
 * BOOK-010 (spec AC-14, AC-9): with booking hours, only the times that fit
 * `party_size` (default 1) under the guest limits and staff stops are
 * listed, and a date with none is `open: false`.
 */
import { availabilityMaxDays } from '@/domain/services/agent-booking'
import { slotsFor, type BookingClock } from '@/domain/services/booking-hours'
import { addDays } from '@/domain/services/booking-calendar'
import { hongKongTime, hongKongToday, type BookingFieldErrors } from '@/domain/services/booking-submission'
import { isCalendarDate, termsRequired } from '@/domain/value-objects/booking-hours'
import type { BookingConfig } from '@/domain/value-objects/booking-config'
import type { AgentBookingDirectory } from '@/domain/ports/booking'
import type { RateLimiterPort } from '@/domain/ports/rate-limiter'
import { resolveAgentBookingTenant } from './resolve-agent-booking-tenant'
import { IP_RETRY_AFTER_SEC, withinAgentIpLimit } from './create-agent-booking'
import { availableTimes, roomApplies, type SlotFits } from '@/domain/services/booking-room'
import type { BookingRoomReader } from '@/domain/ports/booking'
import { fitsInRange } from './booking-room-check'

export interface GetAgentAvailabilityDeps {
  directory: AgentBookingDirectory
  limiter: RateLimiterPort
  now(): Date
  /** BOOK-010: guest counts and stops; absent = no room filter. */
  room?: BookingRoomReader
}

/** The raw query values (null = absent). */
export interface AvailabilityQuery {
  from: string | null
  days: string | null
  partySize: string | null
}

export interface AvailabilityDate {
  date: string
  open: boolean
  /** The bookable times; null = any time (no booking hours set). */
  times: string[] | null
}

export interface AvailabilityBody {
  dates: AvailabilityDate[]
  interval_minutes: number | null
  table_minutes: number | null
  max_party_size: number
  terms: { 'zh-HK': string; en: string } | null
}

export type GetAgentAvailabilityResult =
  | { ok: true; body: AvailabilityBody }
  | { ok: false; reason: 'rate_limited'; retryAfterSec: number }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'invalid'; errors: BookingFieldErrors }

type AvailabilityConfig = Pick<BookingConfig, 'maxPartySize' | 'bookingHours'>

function wholeNumber(raw: string, min: number, max: number): 'invalid' | 'too_small' | 'too_large' | number {
  if (!/^\d+$/.test(raw)) return 'invalid'
  const n = Number(raw)
  if (n < min) return 'too_small'
  return n > max ? 'too_large' : n
}

/** R2: `from` today or later, 1 ≤ days ≤ min(31, window), party_size within the restaurant's limit. */
export function parseAvailabilityQuery(
  query: AvailabilityQuery,
  limits: { today: string; config: AvailabilityConfig }
): { ok: true; from: string; days: number; partySize: number } | { ok: false; errors: BookingFieldErrors } {
  const errors: BookingFieldErrors = {}
  if (query.from === null || query.from === '') errors.from = 'required'
  else if (!isCalendarDate(query.from)) errors.from = 'invalid'
  else if (query.from < limits.today) errors.from = 'past'
  const days = query.days === null || query.days === '' ? 'required' : wholeNumber(query.days, 1, availabilityMaxDays(limits.config.bookingHours))
  if (typeof days === 'string') errors.days = days
  const party = query.partySize === null ? 1 : wholeNumber(query.partySize, 1, limits.config.maxPartySize)
  if (typeof party === 'string') errors.party_size = party
  if (Object.keys(errors).length > 0 || typeof days === 'string' || typeof party === 'string') return { ok: false, errors }
  return { ok: true, from: query.from as string, days, partySize: party }
}

/** Every date from `from` for `days` days, with its bookable times now (BOOK-010: only those `fits` allows). */
export function availabilityBody(
  config: AvailabilityConfig,
  range: { from: string; days: number },
  clock: BookingClock,
  fits?: SlotFits
): AvailabilityBody {
  const hours = config.bookingHours
  const dates = Array.from({ length: range.days }, (_, i) => addDays(range.from, i)).map((date): AvailabilityDate => {
    if (!hours) return { date, open: true, times: null }
    const times = fits ? availableTimes(hours, date, clock, fits) : slotsFor(hours, date, clock).map((slot) => slot.time)
    return { date, open: times.length > 0, times }
  })
  return {
    dates,
    interval_minutes: hours?.intervalMinutes ?? null,
    table_minutes: hours?.tableMinutes ?? null,
    max_party_size: config.maxPartySize,
    terms: hours && termsRequired(hours) ? { 'zh-HK': hours.terms.zh_hk, en: hours.terms.en } : null,
  }
}

export async function getAgentAvailability(
  deps: GetAgentAvailabilityDeps,
  input: { publicId: string; clientIp: string; query: AvailabilityQuery }
): Promise<GetAgentAvailabilityResult> {
  if (!(await withinAgentIpLimit(deps.limiter, input.clientIp))) return { ok: false, reason: 'rate_limited', retryAfterSec: IP_RETRY_AFTER_SEC }
  const tenant = await resolveAgentBookingTenant(deps.directory, input.publicId)
  if (!tenant) return { ok: false, reason: 'not_found' }
  const now = deps.now()
  const clock = { today: hongKongToday(now), nowTime: hongKongTime(now) }
  const parsed = parseAvailabilityQuery(input.query, { today: clock.today, config: tenant.config })
  if (!parsed.ok) return { ok: false, reason: 'invalid', errors: parsed.errors }
  return { ok: true, body: availabilityBody(tenant.config, parsed, clock, await roomFits(deps, tenant, parsed, clock)) }
}

/** BOOK-010: the party-size predicate over the asked dates (one counts read), when room rules apply. */
async function roomFits(
  deps: GetAgentAvailabilityDeps,
  tenant: { restaurantId: string; config: AvailabilityConfig },
  range: { from: string; days: number; partySize: number },
  clock: BookingClock
): Promise<SlotFits | undefined> {
  const hours = tenant.config.bookingHours
  if (!deps.room || !roomApplies(hours)) return undefined
  const to = addDays(range.from, range.days - 1)
  return fitsInRange(deps.room, { restaurantId: tenant.restaurantId, hours, clock }, { from: range.from, to }, range.partySize)
}

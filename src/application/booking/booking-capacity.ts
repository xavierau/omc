/**
 * BOOK-010 (spec S3, AC-8, AC-9, AC-11; threat R3): staff see how full a day
 * is and stop or resume bookings for a whole day, one period or one slot.
 *
 * The restaurant always comes from the caller's session (the route); every
 * read and write here is scoped by it. A stop names something that exists on
 * that date under the booking hours (a period key, a grid slot), so a typo
 * never silently stops nothing. Past dates are refused (spec: a stop in the
 * past is ignored). Add and remove are idempotent.
 *
 * F1 (review P3-2, main ruling): resume removes any stored stop matching the
 * key, checked for shape only, not against the current hours: a stop whose
 * period was renamed (or slot moved off the grid) no longer applies, and
 * staff can still delete it.
 */
import type { BookingRoomReader, BookingStopStore } from '@/domain/ports/booking'
import { addDays, dayNumber } from '@/domain/services/booking-calendar'
import { capacityBadge, capacityDay, type CapacityBadge, type CapacityDay } from '@/domain/services/booking-capacity'
import { periodsOn } from '@/domain/services/booking-hours'
import { EMPTY_ROOM, periodKey, periodSlotTimes, roomApplies, type StopScope, type StopTarget } from '@/domain/services/booking-room'
import { hongKongTime, hongKongToday, type BookingFieldErrors } from '@/domain/services/booking-submission'
import { isBookingTime, isCalendarDate, type BookingHours } from '@/domain/value-objects/booking-hours'
import type { BookingConfig } from '@/domain/value-objects/booking-config'

export interface BookingCapacityDeps {
  getConfig(restaurantId: string): Promise<BookingConfig>
  room: BookingRoomReader
  stops: BookingStopStore
  /** The staff member's display name for "stopped by", null when unknown. */
  staffName(userId: string): Promise<string | null>
  now(): Date
}

/** The month view asks for a calendar page (6 weeks at most), never more. */
export const CAPACITY_MAX_DAYS = 62

export type CapacityQuery = { date: string | null; from: string | null; to: string | null }

/** `hoursOff`: hours stored with BOOK-009's schedule switch off (no limits or stops apply; the block says so). */
export type DayCapacityBody = CapacityDay & { hoursSet: boolean; hoursOff?: boolean }
export type CapacityResult =
  | { ok: true; body: DayCapacityBody | { from: string; to: string; days: Record<string, CapacityBadge> } }
  | { ok: false; errors: BookingFieldErrors }

const NO_CAPACITY = (date: string): DayCapacityBody => ({
  date, hoursSet: false, full: false, stopped: false, stoppedBy: null, stoppedAt: null, periods: [],
})

type Parsed<T> = { ok: true; value: T } | { ok: false; errors: BookingFieldErrors }
const valid = <T>(value: T): Parsed<T> => ({ ok: true, value })
const invalid = <T>(errors: BookingFieldErrors): Parsed<T> => ({ ok: false, errors })

function parseRange(q: CapacityQuery): Parsed<{ from: string; to: string }> {
  if (q.date !== null) return isCalendarDate(q.date) ? valid({ from: q.date, to: q.date }) : invalid({ date: 'invalid' })
  if (!isCalendarDate(q.from) || !isCalendarDate(q.to)) return invalid({ range: 'invalid' })
  const days = dayNumber(q.to) - dayNumber(q.from) + 1
  return days >= 1 && days <= CAPACITY_MAX_DAYS ? valid({ from: q.from, to: q.to }) : invalid({ range: 'invalid' })
}

const datesIn = (from: string, to: string) =>
  Array.from({ length: dayNumber(to) - dayNumber(from) + 1 }, (_, i) => addDays(from, i))

/** GET: `?date` → the day panel's capacity block; `?from&to` → per-date {full, stopped} for the month badges. */
export async function getBookingCapacity(deps: BookingCapacityDeps, input: { restaurantId: string; query: CapacityQuery }): Promise<CapacityResult> {
  const parsed = parseRange(input.query)
  if (!parsed.ok) return parsed
  const range = parsed.value
  const now = deps.now()
  const clock = { today: hongKongToday(now), nowTime: hongKongTime(now) }
  const hours = (await deps.getConfig(input.restaurantId)).bookingHours
  const room = roomApplies(hours) ? await deps.room.readRoom(input.restaurantId, range.from, range.to) : EMPTY_ROOM
  if (input.query.date !== null) {
    if (roomApplies(hours)) return { ok: true, body: { ...capacityDay(hours, range.from, room, clock), hoursSet: true } }
    return { ok: true, body: hours ? { ...NO_CAPACITY(range.from), hoursSet: true, hoursOff: true } : NO_CAPACITY(range.from) }
  }
  const badge = (date: string): CapacityBadge => (roomApplies(hours) ? capacityBadge(hours, date, room, clock) : { full: false, stopped: false })
  return { ok: true, body: { ...range, days: Object.fromEntries(datesIn(range.from, range.to).map((d) => [d, badge(d)])) } }
}

const SCOPES: readonly StopScope[] = ['day', 'period', 'slot']
const asRecord = (raw: unknown) => (raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {})

/** What the stop names, checked against the hours on that date. */
function targetOn(hours: BookingHours, date: string, b: Record<string, unknown>): Parsed<StopTarget> {
  const scope = b.scope as StopScope
  if (!SCOPES.includes(scope)) return invalid({ scope: 'invalid' })
  if (scope === 'day') return valid({ date, scope, periodLabel: null, time: null })
  const periods = periodsOn(hours, date)
  if (scope === 'period') {
    const label = typeof b.periodLabel === 'string' ? b.periodLabel : ''
    const known = periods.some((p) => periodKey(p) === label)
    return known ? valid({ date, scope, periodLabel: label, time: null }) : invalid({ periodLabel: 'unknown_period' })
  }
  const time = isBookingTime(b.time) ? b.time : ''
  const known = periods.some((p) => periodSlotTimes(hours, p).includes(time))
  return known ? valid({ date, scope, periodLabel: null, time }) : invalid({ time: 'unknown_slot' })
}

/** F1 (review P3-2): what a resume names, by shape only (any stored key may be removed). */
function storedTarget(date: string, b: Record<string, unknown>): Parsed<StopTarget> {
  const scope = b.scope as StopScope
  if (!SCOPES.includes(scope)) return invalid({ scope: 'invalid' })
  if (scope === 'day') return valid({ date, scope, periodLabel: null, time: null })
  if (scope === 'period') {
    const label = typeof b.periodLabel === 'string' ? b.periodLabel : ''
    return label ? valid({ date, scope, periodLabel: label, time: null }) : invalid({ periodLabel: 'invalid' })
  }
  return isBookingTime(b.time) ? valid({ date, scope, periodLabel: null, time: b.time }) : invalid({ time: 'invalid' })
}

/** Spec AC-8/AC-9: the body as a stop target, or per-field errors. */
function parseStop(config: BookingConfig, body: unknown, today: string, action: 'stop' | 'resume'): Parsed<StopTarget> {
  const b = asRecord(body)
  if (!isCalendarDate(b.date)) return invalid({ date: 'invalid' })
  if (b.date < today) return invalid({ date: 'past' })
  if (action === 'resume') return storedTarget(b.date, b)
  if (!roomApplies(config.bookingHours)) return invalid({ form: 'hours_not_set' })
  return targetOn(config.bookingHours, b.date, b)
}

export type StopView = StopTarget & { stoppedBy: string | null; stoppedAt: string }
export type ChangeStopResult = { ok: true; stop: StopView | null } | { ok: false; errors: BookingFieldErrors }

/** POST (stop) / DELETE (resume): idempotent, scoped by the session's restaurant. */
export async function changeBookingStop(
  deps: BookingCapacityDeps,
  input: { restaurantId: string; userId: string; action: 'stop' | 'resume'; body: unknown }
): Promise<ChangeStopResult> {
  const now = deps.now()
  const config = await deps.getConfig(input.restaurantId)
  const parsed = parseStop(config, input.body, hongKongToday(now), input.action)
  if (!parsed.ok) return parsed
  const target = parsed.value
  if (input.action === 'resume') {
    await deps.stops.remove(input.restaurantId, target)
    return { ok: true, stop: null }
  }
  const stoppedByName = await deps.staffName(input.userId)
  const stored = await deps.stops.add(input.restaurantId, { ...target, stoppedById: input.userId, stoppedByName, stoppedAt: now.toISOString() })
  return { ok: true, stop: { ...target, stoppedBy: stored.stoppedByName, stoppedAt: stored.stoppedAt } }
}

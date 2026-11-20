/**
 * BOOK-010 (plan D4, spec S2): "is there room" — the second half of the one
 * rule check every booking channel shares (BOOK-009 `checkSlot` is the
 * first). Pure: the guest counts and the stops are read by the caller.
 *
 * A request fits when, on its date, the day, its period and its slot are not
 * stopped, `slot guests + party ≤ perSlot` and `period guests + party ≤
 * perMeal`. Guests = party sizes of pending + confirmed bookings (unverified
 * agent bookings never count). A period is keyed by its label, or by
 * "first-last" when it has none (the key staff stop by).
 *
 * The app answers early with these functions; the database function
 * `insert_booking_request_if_room` (migration 092) is the final authority
 * under concurrent requests, and gets its inputs from `roomCheckFor`.
 */
import type { BookingHours, BookingPeriod } from '@/domain/value-objects/booking-hours'
import { limitsOf } from '@/domain/value-objects/booking-limits'
import { periodsOn, slotsFor, type BookingClock } from './booking-hours'
import { fromMinutes, toMinutes } from './booking-calendar'

export type StopScope = 'day' | 'period' | 'slot'

/** What a stop applies to: a date, plus the period key (scope period) or the HH:MM slot (scope slot). */
export interface StopTarget {
  date: string
  scope: StopScope
  periodLabel: string | null
  time: string | null
}

export interface BookingStop extends StopTarget {
  stoppedById: string | null
  /** Shown to staff ("Amy · 14:02"). */
  stoppedByName: string | null
  stoppedAt: string
}

/** date (YYYY-MM-DD) → slot time (HH:MM) → guests. */
export type GuestCounts = Record<string, Record<string, number>>

export interface RoomState {
  counts: GuestCounts
  stops: BookingStop[]
}

export const EMPTY_ROOM: RoomState = { counts: {}, stops: [] }

export type RoomRefusal =
  | { kind: 'stopped'; scope: StopScope }
  | { kind: 'full'; scope: 'slot' | 'meal'; guests: number; limit: number }

/** The inputs the database function needs for one slot (period rules stay here). */
export interface RoomCheck {
  periodKey: string | null
  periodFirst: string | null
  periodLast: string | null
  perSlot: number | null
  perMeal: number | null
}

export interface RoomRequest {
  date: string
  time: string
  partySize: number
}

/** True when a date + time can take a party now. */
export type SlotFits = (date: string, time: string) => boolean

/**
 * Whether room rules (limits and stops) apply to this restaurant at all:
 * only when booking hours are set, since periods and slots come from them.
 * Without hours every channel is exactly BOOK-009 (spec AC-3).
 */
export function roomApplies(hours: BookingHours | null | undefined): hours is BookingHours {
  return !!hours
}

export const periodKey = (p: BookingPeriod): string => p.label ?? `${p.first}-${p.last}`

/** The period whose booking times contain `time` on `date`, or null. */
export function periodAt(hours: BookingHours, date: string, time: string): BookingPeriod | null {
  return periodsOn(hours, date).find((p) => p.first <= time && time <= p.last) ?? null
}

/** The period's grid times (first, first + interval, …, ≤ last). */
export function periodSlotTimes(hours: BookingHours, p: BookingPeriod): string[] {
  const times: string[] = []
  for (let m = toMinutes(p.first); m <= toMinutes(p.last); m += hours.intervalMinutes) times.push(fromMinutes(m))
  return times
}

export const slotGuests = (counts: GuestCounts, date: string, time: string) => counts[date]?.[time] ?? 0

/** Guests at any time inside the period's range (off-grid bookings included, as the database counts). */
export function periodGuests(counts: GuestCounts, date: string, p: BookingPeriod): number {
  return Object.entries(counts[date] ?? {})
    .filter(([time]) => p.first <= time && time <= p.last)
    .reduce((sum, [, guests]) => sum + guests, 0)
}

export const sameStopTarget = (a: StopTarget, b: StopTarget) =>
  a.date === b.date && a.scope === b.scope && (a.periodLabel ?? null) === (b.periodLabel ?? null) && (a.time ?? null) === (b.time ?? null)

export function stopOf(stops: readonly BookingStop[], target: StopTarget): BookingStop | null {
  return stops.find((s) => sameStopTarget(s, target)) ?? null
}

/** The stop that closes `date` + `time` (day, then its period, then the slot), or null. */
function stoppedBy(stops: readonly BookingStop[], date: string, time: string, period: BookingPeriod | null): StopScope | null {
  if (stopOf(stops, { date, scope: 'day', periodLabel: null, time: null })) return 'day'
  if (period && stopOf(stops, { date, scope: 'period', periodLabel: periodKey(period), time: null })) return 'period'
  return stopOf(stops, { date, scope: 'slot', periodLabel: null, time }) ? 'slot' : null
}

/** Spec S2: why `request` does not fit, or null when it does. */
export function roomFor(hours: BookingHours, request: RoomRequest, room: RoomState): RoomRefusal | null {
  const { date, time, partySize } = request
  const period = periodAt(hours, date, time)
  const stopped = stoppedBy(room.stops, date, time, period)
  if (stopped) return { kind: 'stopped', scope: stopped }
  const { perSlot, perMeal } = limitsOf(hours)
  const atSlot = slotGuests(room.counts, date, time)
  if (perSlot !== null && atSlot + partySize > perSlot) return { kind: 'full', scope: 'slot', guests: atSlot, limit: perSlot }
  const atMeal = period ? periodGuests(room.counts, date, period) : 0
  if (period && perMeal !== null && atMeal + partySize > perMeal) return { kind: 'full', scope: 'meal', guests: atMeal, limit: perMeal }
  return null
}

/** What `insert_booking_request_if_room` needs for this slot. */
export function roomCheckFor(hours: BookingHours, date: string, time: string): RoomCheck {
  const period = periodAt(hours, date, time)
  const { perSlot, perMeal } = limitsOf(hours)
  return {
    periodKey: period ? periodKey(period) : null,
    periodFirst: period?.first ?? null,
    periodLast: period?.last ?? null,
    perSlot,
    perMeal,
  }
}

/** A predicate for "a party of `partySize` fits here" (suggestions, availability). */
export function fitsFor(hours: BookingHours, room: RoomState, partySize: number): SlotFits {
  return (date, time) => roomFor(hours, { date, time, partySize }, room) === null
}

/** Spec AC-12/AC-14: the times a diner may pick on `date` now that also fit the party. */
export function availableTimes(hours: BookingHours, date: string, clock: BookingClock, fits: SlotFits): string[] {
  return slotsFor(hours, date, clock)
    .map((s) => s.time)
    .filter((time) => fits(date, time))
}

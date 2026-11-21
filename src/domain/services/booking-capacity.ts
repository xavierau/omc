/**
 * BOOK-010 (spec S3): how full a day is, for staff. Pure, from the booking
 * hours, the guest counts and the stops of the dates asked for.
 *
 * - A slot is `full` when it cannot take a party of 1 under the limits
 *   (stops are reported separately as `stopped`).
 * - A period is `full` when its meal limit is reached or every slot is full.
 * - A day is `full` (month badge 已滿) when it has slots and none of them can
 *   take a party of 1, limits or stops; `stopped` (已停止) when staff stopped
 *   the whole day. A closed day is neither.
 */
import type { BookingHours, BookingPeriod } from '@/domain/value-objects/booking-hours'
import { limitsOf } from '@/domain/value-objects/booking-limits'
import { periodsOn } from './booking-hours'
import {
  fitsFor,
  periodGuests,
  periodKey,
  periodSlotTimes,
  slotGuests,
  stopOf,
  type BookingStop,
  type RoomState,
  type StopTarget,
} from './booking-room'

export interface StopInfo {
  stopped: boolean
  /** The staff member's display name, null when not stopped or unknown. */
  stoppedBy: string | null
  stoppedAt: string | null
}

export interface CapacitySlot extends StopInfo {
  time: string
  guests: number
  limit: number | null
  full: boolean
}

export interface CapacityPeriod extends StopInfo {
  /** What a period stop names (`periodLabel` in the stops API). */
  key: string
  label: string | null
  first: string
  last: string
  guests: number
  limit: number | null
  full: boolean
  slots: CapacitySlot[]
}

export interface CapacityDay extends StopInfo {
  date: string
  full: boolean
  periods: CapacityPeriod[]
}

export interface CapacityBadge {
  full: boolean
  stopped: boolean
}

function stopInfo(stop: BookingStop | null): StopInfo {
  return { stopped: !!stop, stoppedBy: stop?.stoppedByName ?? null, stoppedAt: stop?.stoppedAt ?? null }
}

const target = (date: string, scope: StopTarget['scope'], periodLabel: string | null, time: string | null): StopTarget => ({
  date, scope, periodLabel, time,
})

function capacitySlot(hours: BookingHours, date: string, time: string, room: RoomState, mealFull: boolean): CapacitySlot {
  const guests = slotGuests(room.counts, date, time)
  const limit = limitsOf(hours).perSlot
  const full = mealFull || (limit !== null && guests >= limit)
  return { time, guests, limit, full, ...stopInfo(stopOf(room.stops, target(date, 'slot', null, time))) }
}

function capacityPeriod(hours: BookingHours, date: string, p: BookingPeriod, room: RoomState): CapacityPeriod {
  const guests = periodGuests(room.counts, date, p)
  const limit = limitsOf(hours).perMeal
  const mealFull = limit !== null && guests >= limit
  const slots = periodSlotTimes(hours, p).map((time) => capacitySlot(hours, date, time, room, mealFull))
  const key = periodKey(p)
  return {
    key, label: p.label ?? null, first: p.first, last: p.last, guests, limit,
    full: mealFull || (slots.length > 0 && slots.every((s) => s.full)),
    slots,
    ...stopInfo(stopOf(room.stops, target(date, 'period', key, null))),
  }
}

/** The day panel's capacity block (spec S3, AC-8). */
export function capacityDay(hours: BookingHours, date: string, room: RoomState): CapacityDay {
  return {
    date,
    full: capacityBadge(hours, date, room).full,
    periods: periodsOn(hours, date).map((p) => capacityPeriod(hours, date, p, room)),
    ...stopInfo(stopOf(room.stops, target(date, 'day', null, null))),
  }
}

/** The period's meal limit is reached (its slots then read "Meal full", not "Full"). */
export function mealReached(period: Pick<CapacityPeriod, 'guests' | 'limit'>): boolean {
  return period.limit !== null && period.guests >= period.limit
}

export type SlotBadge = 'full' | 'meal_full' | null

/**
 * The staff slot badge: "Full" only when the slot itself is full (its own
 * limit) or stopped; "Meal full" when only the period's meal limit is
 * reached, so "0 / 30" never reads as a full slot.
 */
export function slotBadge(period: Pick<CapacityPeriod, 'guests' | 'limit'>, slot: CapacitySlot): SlotBadge {
  if (slot.stopped || (slot.limit !== null && slot.guests >= slot.limit)) return 'full'
  return mealReached(period) ? 'meal_full' : null
}

/** The month cell's badge (spec S3, AC-9): no slot fits a party of 1 → full; the whole day stopped → stopped. */
export function capacityBadge(hours: BookingHours, date: string, room: RoomState): CapacityBadge {
  const fits = fitsFor(hours, room, 1)
  const times = periodsOn(hours, date).flatMap((p) => periodSlotTimes(hours, p))
  return {
    full: times.length > 0 && !times.some((time) => fits(date, time)),
    stopped: !!stopOf(room.stops, target(date, 'day', null, null)),
  }
}

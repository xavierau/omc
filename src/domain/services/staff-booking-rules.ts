/**
 * BOOK-013 (spec AC-3, AC-8; owner decision 3): the booking rules a staff
 * booking breaks. Staff may book anyway, so this never refuses: it lists
 * EVERY broken rule (hours/notice/window from BOOK-009 `checkSlot`, stops and
 * the slot and meal guest limits from BOOK-010) for the prompt and the
 * events row. No rules apply without an active schedule (BOOK-010 AC-3).
 * On an edit the booking's own guests are taken off its current slot first,
 * so a booking never counts against itself (AC-8).
 */
import { activeSchedule, type BookingHours } from '@/domain/value-objects/booking-hours'
import { limitsOf } from '@/domain/value-objects/booking-limits'
import { checkSlot, type BookingClock, type SlotRefusal } from './booking-hours'
import {
  periodAt,
  periodGuests,
  periodKey,
  slotGuests,
  stopOf,
  type GuestCounts,
  type RoomRequest,
  type RoomState,
  type StopScope,
} from './booking-room'

export type BrokenRule =
  | { code: SlotRefusal }
  | { code: 'stopped'; scope: StopScope }
  | { code: 'slot_full'; time: string; guests: number; limit: number }
  | { code: 'meal_full'; period: string; guests: number; limit: number }

/** The booking as it stands before an edit (its guests are not counted against itself). */
export interface OwnSlot {
  date: string
  time: string
  partySize: number
  /** Only pending and confirmed bookings are in the guest counts. */
  counted: boolean
}

function withoutOwn(counts: GuestCounts, own: OwnSlot | undefined): GuestCounts {
  if (!own?.counted) return counts
  const day = { ...(counts[own.date] ?? {}) }
  day[own.time] = Math.max(0, (day[own.time] ?? 0) - own.partySize)
  return { ...counts, [own.date]: day }
}

function stopRule(hours: BookingHours, req: RoomRequest, room: RoomState): BrokenRule[] {
  const period = periodAt(hours, req.date, req.time)
  const at = (scope: StopScope, periodLabel: string | null, time: string | null) =>
    stopOf(room.stops, { date: req.date, scope, periodLabel, time })
  if (at('day', null, null)) return [{ code: 'stopped', scope: 'day' }]
  if (period && at('period', periodKey(period), null)) return [{ code: 'stopped', scope: 'period' }]
  return at('slot', null, req.time) ? [{ code: 'stopped', scope: 'slot' }] : []
}

function limitRules(hours: BookingHours, req: RoomRequest, counts: GuestCounts): BrokenRule[] {
  const { perSlot, perMeal } = limitsOf(hours)
  const out: BrokenRule[] = []
  const atSlot = slotGuests(counts, req.date, req.time)
  if (perSlot !== null && atSlot + req.partySize > perSlot) out.push({ code: 'slot_full', time: req.time, guests: atSlot, limit: perSlot })
  const period = periodAt(hours, req.date, req.time)
  const atMeal = period ? periodGuests(counts, req.date, period) : 0
  if (period && perMeal !== null && atMeal + req.partySize > perMeal) {
    out.push({ code: 'meal_full', period: periodKey(period), guests: atMeal, limit: perMeal })
  }
  return out
}

export function brokenRules(
  storedHours: BookingHours | null | undefined,
  req: RoomRequest,
  room: RoomState,
  clock: BookingClock,
  own?: OwnSlot
): BrokenRule[] {
  const hours = activeSchedule(storedHours)
  if (!hours) return []
  const slot = checkSlot(hours, req.date, req.time, clock)
  const counts = withoutOwn(room.counts, own)
  return [...(slot ? [{ code: slot }] : []), ...stopRule(hours, req, room), ...limitRules(hours, req, counts)]
}

/** For the events row (R9): the codes only, never a name or phone. */
export const brokenRuleCodes = (rules: BrokenRule[]): string[] => rules.map((r) => r.code)

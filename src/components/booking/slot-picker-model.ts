/**
 * BOOK-009 S2: what the slot picker shows, as pure functions over the SAME
 * domain helpers the server checks with (`slotsFor`, `periodsOn`,
 * `windowEnd`), so a day or slot the page offers is one the server accepts
 * at that clock (spec AC-6). Presentation grouping only lives here.
 * BOOK-010 (spec AC-12, AC-13): whether a slot can take the party comes from
 * the server's per-slot room (`SlotRoom`); the page only compares, so it
 * cannot disagree with the server's counting rule.
 */
import { periodsOn, slotsFor, windowEnd, type BookingClock, type BookingSlot } from '@/domain/services/booking-hours'
import { toMinutes, weekdayOf } from '@/domain/services/booking-calendar'
import type { BookingHours } from '@/domain/value-objects/booking-hours'
import type { SlotFits } from '@/domain/services/booking-room'
import type { SlotRoom } from '@/application/booking/resolve-booking-link'

/** `booked` (BOOK-010): open, but no slot can take the party (shown 已滿). */
export type DayState = 'past' | 'beyond' | 'closed' | 'full' | 'booked' | 'open'

/** past: before today; beyond: after the window; closed: weekly or special; full: no slot left (minimum notice). */
export function dayState(hours: BookingHours, date: string, clock: BookingClock): DayState {
  if (date < clock.today) return 'past'
  if (date > windowEnd(hours, clock.today)) return 'beyond'
  if (periodsOn(hours, date).length === 0) return 'closed'
  return slotsFor(hours, date, clock).length > 0 ? 'open' : 'full'
}

/** BOOK-010: a slot fits when the server's room for it is at least the party (no party yet = 1); unlisted = fits. */
export function slotFits(room: SlotRoom | undefined, party: number | null): SlotFits {
  const size = party ?? 1
  return (date, time) => (room?.[date]?.[time] ?? Number.POSITIVE_INFINITY) >= size
}

/** BOOK-010 AC-12: the day state with the party taken into account. */
export function dinerDayState(hours: BookingHours, date: string, clock: BookingClock, fits: SlotFits): DayState {
  const state = dayState(hours, date, clock)
  if (state !== 'open') return state
  return slotsFor(hours, date, clock).some((s) => fits(date, s.time)) ? 'open' : 'booked'
}

/** BOOK-010 AC-12: after a party change, clear a chosen day or time that can no longer take it. */
export function refitChoice(
  values: { date: string; time: string },
  hours: BookingHours,
  clock: BookingClock,
  fits: SlotFits
): { date?: ''; time?: '' } {
  if (values.date && dinerDayState(hours, values.date, clock, fits) === 'booked') return { date: '' }
  if (values.date && values.time && !fits(values.date, values.time)) return { time: '' }
  return {}
}

export interface MonthRef {
  year: number
  /** 1–12 */
  month: number
}

const pad = (n: number) => String(n).padStart(2, '0')
export const monthOf = (date: string): MonthRef => ({ year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) })
const monthIndex = (m: MonthRef) => m.year * 12 + (m.month - 1)
const fromIndex = (i: number): MonthRef => ({ year: Math.floor(i / 12), month: (i % 12) + 1 })

/** Months from today's to the window end's, in order (the calendar's prev/next range). */
export function monthsInWindow(hours: BookingHours, today: string): MonthRef[] {
  const first = monthIndex(monthOf(today))
  const last = monthIndex(monthOf(windowEnd(hours, today)))
  return Array.from({ length: last - first + 1 }, (_, i) => fromIndex(first + i))
}

const SUNDAY_FIRST = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

/** The month as weeks of 7 cells, Sunday first; null pads the first and last week. */
export function monthGrid({ year, month }: MonthRef): (string | null)[][] {
  const first = `${year}-${pad(month)}-01`
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const cells: (string | null)[] = Array(SUNDAY_FIRST.indexOf(weekdayOf(first))).fill(null)
  for (let d = 1; d <= days; d++) cells.push(`${year}-${pad(month)}-${pad(d)}`)
  while (cells.length % 7 !== 0) cells.push(null)
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7))
}

/** Sunday-first weekday key of a date (calendar headers, day labels). */
export const weekdayKey = (date: string) => weekdayOf(date)

export type DefaultGroup = 'lunch' | 'afternoon' | 'evening'

export interface SlotGroup {
  /** The period's label; null when the slots have none (then `fallback` names the group). */
  label: string | null
  fallback: DefaultGroup | null
  slots: BookingSlot[]
}

/** Spec S2 (brief): unlabelled slots group as 中午 < 15:00, 下午 15:00–16:59, 晚上 ≥ 17:00. */
export function defaultGroupOf(time: string): DefaultGroup {
  const m = toMinutes(time)
  return m < 15 * 60 ? 'lunch' : m < 17 * 60 ? 'afternoon' : 'evening'
}

/** Consecutive slots with the same label (or default group) form one group, in time order. */
export function groupSlots(slots: BookingSlot[]): SlotGroup[] {
  const groups: SlotGroup[] = []
  for (const slot of slots) {
    const fallback = slot.label === null ? defaultGroupOf(slot.time) : null
    const last = groups[groups.length - 1]
    if (last && last.label === slot.label && last.fallback === fallback) last.slots.push(slot)
    else groups.push({ label: slot.label, fallback, slots: [slot] })
  }
  return groups
}

export type MissingStep = 'party' | 'date' | 'time' | 'terms'

/** The first step still missing (spec AC-7 names it on the submit button), or null when ready. */
export function missingStep(s: { partySize: number | null; date: string; time: string; termsRequired: boolean; accepted: boolean }): MissingStep | null {
  if (s.partySize === null) return 'party'
  if (s.date === '') return 'date'
  if (s.time === '') return 'time'
  if (s.termsRequired && !s.accepted) return 'terms'
  return null
}

/** Codes that mean the page's times are out of date (spec AC-9): the admin changed hours, or the clock moved on. */
// BOOK-010 AC-13: `full` too (the slot filled while the page was open).
const TIMES_CHANGED = new Set(['closed_day', 'outside_hours', 'too_soon', 'too_far', 'past', 'past_time', 'full'])

export function timesChanged(errors: Record<string, string>): boolean {
  return TIMES_CHANGED.has(errors.date) || TIMES_CHANGED.has(errors.time)
}

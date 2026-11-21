/**
 * BOOK-009 (plan D2): the one rule check every booking channel shares (the
 * booking page, personal agents through PAP, our AI reply agent). Pure, Hong
 * Kong time only. `parseBookingSubmission` calls `checkSlot`; agents use
 * `suggestTimes` for alternatives and `summarize` for the rules text.
 *
 * A special date replaces its weekday's periods. A slot is bookable when it
 * is on a period's grid (first, first + interval, …, ≤ last), its date is
 * within today … today + aheadDays, and it is later than now and at least
 * `noticeHours` ahead (both measured across midnight).
 */
import { isBookingTime, type BookingHours, type BookingPeriod } from '@/domain/value-objects/booking-hours'
import { absoluteMinutes, addDays, fromMinutes, toMinutes, weekdayOf } from './booking-calendar'

export { summarize } from './booking-hours-summary'

export interface BookingClock {
  /** Hong Kong today, YYYY-MM-DD. */
  today: string
  /** Hong Kong now, HH:MM. */
  nowTime: string
}

export interface BookingSlot {
  time: string
  /** The period's label, null when it has none. */
  label: string | null
}

export type SlotRefusal = 'closed_day' | 'outside_hours' | 'too_soon' | 'too_far'

export interface SuggestedTime {
  date: string
  time: string
}

/** The periods that apply on `date`: its special date's, else its weekday's. */
export function periodsOn(hours: BookingHours, date: string): BookingPeriod[] {
  const special = hours.special.find((s) => s.date === date)
  return special ? special.periods : hours.weekly[weekdayOf(date)]
}

/** The last bookable date. */
export function windowEnd(hours: BookingHours, today: string): string {
  return addDays(today, hours.aheadDays)
}

/** Every grid slot of the date, ignoring notice and window, by time. */
function gridSlots(hours: BookingHours, date: string): BookingSlot[] {
  const byTime = new Map<number, BookingSlot>()
  for (const p of periodsOn(hours, date)) {
    const label = p.label ?? null
    for (let m = toMinutes(p.first); m <= toMinutes(p.last); m += hours.intervalMinutes) {
      if (!byTime.has(m)) byTime.set(m, { time: fromMinutes(m), label })
    }
  }
  return [...byTime.entries()].sort(([a], [b]) => a - b).map(([, slot]) => slot)
}

function pastNotice(hours: BookingHours, date: string, time: string, clock: BookingClock): boolean {
  const slot = absoluteMinutes(date, time)
  const now = absoluteMinutes(clock.today, clock.nowTime)
  return slot > now && slot >= now + hours.noticeHours * 60
}

const inWindow = (hours: BookingHours, date: string, clock: BookingClock) =>
  date >= clock.today && date <= windowEnd(hours, clock.today)

/** The slots a diner may pick on `date` now (empty when closed or outside the window). */
export function slotsFor(hours: BookingHours, date: string, clock: BookingClock): BookingSlot[] {
  if (!inWindow(hours, date, clock)) return []
  return gridSlots(hours, date).filter((s) => pastNotice(hours, date, s.time, clock))
}

/** null when `date` + `time` is bookable now, else why not (spec AC-8). */
export function checkSlot(hours: BookingHours, date: string, time: string, clock: BookingClock): SlotRefusal | null {
  if (date < clock.today) return 'too_soon'
  if (date > windowEnd(hours, clock.today)) return 'too_far'
  if (periodsOn(hours, date).length === 0) return 'closed_day'
  if (!gridSlots(hours, date).some((s) => s.time === time)) return 'outside_hours'
  return pastNotice(hours, date, time, clock) ? null : 'too_soon'
}

function nearestFirst(slots: BookingSlot[], wanted: number): BookingSlot[] {
  const distance = (s: BookingSlot) => Math.abs(toMinutes(s.time) - wanted)
  return [...slots].sort((a, b) => distance(a) - distance(b) || a.time.localeCompare(b.time))
}

/**
 * Up to `n` bookable times nearest the one asked for (spec AC-12): the same
 * date first, then each following date in the window, nearest first within
 * a date (ties: the earlier time).
 */
export function suggestTimes(hours: BookingHours, date: string, time: string, clock: BookingClock, n = 3): SuggestedTime[] {
  const wanted = isBookingTime(time) ? toMinutes(time) : 0
  const out: SuggestedTime[] = []
  const last = windowEnd(hours, clock.today)
  for (let d = date < clock.today ? clock.today : date; d <= last && out.length < n; d = addDays(d, 1)) {
    for (const s of nearestFirst(slotsFor(hours, d, clock), wanted).slice(0, n - out.length)) out.push({ date: d, time: s.time })
  }
  return out
}

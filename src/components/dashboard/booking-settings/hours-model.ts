/**
 * BOOK-009 S1: pure edits on the booking hours the settings form holds.
 * Nothing here saves: every edit returns a new value and the section's Save
 * sends it (spec AC-3: "Copy to all days" changes rows, not the stored value).
 */
import { MAX_PERIODS_PER_DAY, WEEKDAYS, type BookingHours, type BookingPeriod, type SpecialBookingDate, type Weekday } from '@/domain/value-objects/booking-hours'

export type CopyTarget = 'all' | 'weekdays' | 'weekend'

const COPY_TARGETS: Record<CopyTarget, readonly Weekday[]> = {
  all: WEEKDAYS,
  weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
  weekend: ['sat', 'sun'],
}

/** What "+ 加時段" adds: lunch first, then dinner, then an empty pair to fill in. */
const NEW_PERIODS: readonly BookingPeriod[] = [
  { first: '12:00', last: '14:00' },
  { first: '18:00', last: '21:30' },
]

const clonePeriods = (periods: BookingPeriod[]) => periods.map((p) => ({ ...p }))

function newPeriod(existing: BookingPeriod[]): BookingPeriod {
  return { ...(NEW_PERIODS[existing.length] ?? { first: '', last: '' }) }
}

/** Adds a period (at most MAX_PERIODS_PER_DAY). */
export function addPeriodTo(periods: BookingPeriod[]): BookingPeriod[] {
  return periods.length >= MAX_PERIODS_PER_DAY ? periods : [...periods, newPeriod(periods)]
}

export function patchPeriod(periods: BookingPeriod[], index: number, patch: Partial<BookingPeriod>): BookingPeriod[] {
  return periods.map((p, i) => (i === index ? { ...p, ...patch } : p))
}

export const removePeriod = (periods: BookingPeriod[], index: number) => periods.filter((_, i) => i !== index)

export function setDay(hours: BookingHours, day: Weekday, periods: BookingPeriod[]): BookingHours {
  return { ...hours, weekly: { ...hours.weekly, [day]: periods } }
}

/** Open adds a first period; Closed clears the day. */
export function setDayOpen(hours: BookingHours, day: Weekday, open: boolean): BookingHours {
  return setDay(hours, day, open ? addPeriodTo([]) : [])
}

/** "複製到…": the source day's periods onto every day of the target (spec AC-3). */
export function copyDay(hours: BookingHours, from: Weekday, target: CopyTarget): BookingHours {
  const weekly = { ...hours.weekly }
  for (const day of COPY_TARGETS[target]) weekly[day] = clonePeriods(hours.weekly[from])
  return { ...hours, weekly }
}

/** True when no weekday and no special date has a period: diners cannot pick any time. */
export function noBookableTimes(hours: BookingHours): boolean {
  return WEEKDAYS.every((d) => hours.weekly[d].length === 0) && hours.special.every((s) => s.periods.length === 0)
}

export function addSpecial(hours: BookingHours, date: string): BookingHours {
  return { ...hours, special: [...hours.special, { date, label: '', periods: [] }] }
}

export function patchSpecial(hours: BookingHours, index: number, patch: Partial<SpecialBookingDate>): BookingHours {
  return { ...hours, special: hours.special.map((s, i) => (i === index ? { ...s, ...patch } : s)) }
}

export const removeSpecial = (hours: BookingHours, index: number): BookingHours => ({
  ...hours,
  special: hours.special.filter((_, i) => i !== index),
})

/** Closed ↔ own periods for a special date. */
export function setSpecialOpen(hours: BookingHours, index: number, open: boolean): BookingHours {
  return patchSpecial(hours, index, { periods: open ? addPeriodTo([]) : [] })
}

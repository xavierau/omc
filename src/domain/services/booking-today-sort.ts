/**
 * BOOK-013 AC-25: the order of the Today list. Pure and client-side over the
 * already-capped list (R12), so it composes with the search filter.
 *
 * Keys: Time (earliest first), Name (A–Z by the active locale's collation, so
 * zh-HK names sort as zh-HK does), Guests (largest first), Status (Late,
 * Waiting, Needs reply, Arrived, No-show). Selecting the active key again
 * reverses it. Ties fall back to time, then name, always ascending.
 */
import type { HongKongMoment } from '@/domain/ports/booking'
import { arrivalState, type ArrivalState, type CheckinCandidate } from './booking-checkin'

export const TODAY_SORT_KEYS = ['time', 'name', 'guests', 'status'] as const
export type TodaySortKey = (typeof TODAY_SORT_KEYS)[number]
export type TodaySortDir = 'asc' | 'desc'
export interface TodaySort {
  key: TodaySortKey
  dir: TodaySortDir
}

export const DEFAULT_TODAY_SORT: TodaySort = { key: 'time', dir: 'asc' }

export type TodaySortable = CheckinCandidate & { name: string | null; partySize: number }

/** Guests start largest first; every other key ascending. */
export const defaultTodaySortDir = (key: TodaySortKey): TodaySortDir => (key === 'guests' ? 'desc' : 'asc')

/** The sort after selecting `key`: the active key reverses, another starts at its default. */
export function nextTodaySort(current: TodaySort, key: TodaySortKey): TodaySort {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  return { key, dir: defaultTodaySortDir(key) }
}

const STATUS_RANK: Record<ArrivalState['kind'], number> = { late: 0, waiting: 1, needs_reply: 2, arrived: 3, no_show: 4, other: 5 }

interface SortContext {
  now: HongKongMoment
  locale: string
}

type Compare<T> = (a: T, b: T) => number

/** A missing name sorts after every named booking, in either direction. */
function nameCompare(collator: Intl.Collator): Compare<TodaySortable> {
  return (a, b) => collator.compare(a.name ?? '', b.name ?? '')
}

function primary(key: TodaySortKey, ctx: SortContext, byName: Compare<TodaySortable>): Compare<TodaySortable> {
  if (key === 'name') return byName
  if (key === 'guests') return (a, b) => a.partySize - b.partySize
  if (key === 'status') return (a, b) => STATUS_RANK[arrivalState(a, ctx.now).kind] - STATUS_RANK[arrivalState(b, ctx.now).kind]
  return (a, b) => a.bookingTime.localeCompare(b.bookingTime)
}

const unnamedLast = (key: TodaySortKey, a: TodaySortable, b: TodaySortable): number =>
  key === 'name' ? Number(a.name === null) - Number(b.name === null) : 0

/** A new array in `sort` order; the input is never changed. */
export function sortTodayBookings<T extends TodaySortable>(bookings: readonly T[], sort: TodaySort, ctx: SortContext): T[] {
  const byName = nameCompare(new Intl.Collator(ctx.locale))
  const main = primary(sort.key, ctx, byName)
  const sign = sort.dir === 'asc' ? 1 : -1
  return [...bookings].sort(
    (a, b) =>
      unnamedLast(sort.key, a, b) ||
      sign * main(a, b) ||
      a.bookingTime.localeCompare(b.bookingTime) ||
      byName(a, b),
  )
}

export type TodayMeal = 'lunch' | 'dinner'

/** Lunch before 16:00, Dinner from 16:00 (Hong Kong local times, "HH:MM"). */
export const LUNCH_ENDS = '16:00'
export const mealOf = (time: string): TodayMeal => (time < LUNCH_ENDS ? 'lunch' : 'dinner')

/** Meal headings over a time-sorted list, in list order; a meal with no rows has no heading. */
export function todayMealGroups<T extends { bookingTime: string }>(sorted: readonly T[]): Array<{ meal: TodayMeal; bookings: T[] }> {
  const groups: Array<{ meal: TodayMeal; bookings: T[] }> = []
  for (const b of sorted) {
    const meal = mealOf(b.bookingTime)
    const last = groups[groups.length - 1]
    if (last?.meal === meal) last.bookings.push(b)
    else groups.push({ meal, bookings: [b] })
  }
  return groups
}

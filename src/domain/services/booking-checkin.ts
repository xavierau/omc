/**
 * BOOK-013 (spec S7; threat R14): the Today view's arrival rules, counters and
 * search. Check-in is staff finding the booking on today's list (name, phone,
 * time) and one Arrived tap; there is no code or QR (owner decision 8).
 */
import { absoluteMinutes } from './booking-calendar'
import { hongKongTime } from './booking-submission'
import type { HongKongMoment } from '@/domain/ports/booking'

/** Spec S7: a waiting booking is "late" this many minutes after its time. */
export const LATE_AFTER_MINUTES = 15
/** R12: the most bookings one Today list returns; more sets `truncated`. */
export const TODAY_LIST_CAP = 300

export interface CheckinCandidate {
  id?: string
  /** BOOK-006: set on a change request, the booking it would replace. */
  replacesBookingId?: string | null
  status: string
  bookingDate: string
  bookingTime: string
  checkedInAt?: string | null
  openChange?: unknown
}

/** R14: Arrived is offered on a confirmed booking dated today (HK), not yet arrived, with no open change. */
export function canCheckIn(b: CheckinCandidate, today: string): boolean {
  return b.status === 'confirmed' && b.bookingDate === today && !b.checkedInAt && !b.openChange
}

export type ArrivalState =
  | { kind: 'arrived'; at: string }
  | { kind: 'no_show' }
  | { kind: 'late'; minutes: number }
  | { kind: 'waiting' }
  | { kind: 'needs_reply' }
  | { kind: 'other' }

/** Spec S7: Waiting; Late N min from 15 minutes past the time; Arrived HH:MM; No-show; Needs reply (pending). */
export function arrivalState(b: CheckinCandidate, now: HongKongMoment): ArrivalState {
  if (b.checkedInAt) return { kind: 'arrived', at: hongKongTime(new Date(b.checkedInAt)) }
  if (b.status === 'no_show') return { kind: 'no_show' }
  if (b.status === 'pending') return { kind: 'needs_reply' }
  if (b.status !== 'confirmed') return { kind: 'other' }
  const late = absoluteMinutes(now.date, now.time) - absoluteMinutes(b.bookingDate, b.bookingTime)
  return late >= LATE_AFTER_MINUTES ? { kind: 'late', minutes: late } : { kind: 'waiting' }
}

export interface TodayCounters {
  guestsArrived: number
  guestsExpected: number
  waiting: number
  late: number
  noShow: number
}

/**
 * Review R7 (BOOK-006 rule, as member stats and the "need a reply" count): a
 * pending change request is the same party as the booking it would replace,
 * so with both in the list only the standing original counts.
 */
function pendingChangeOfListed(b: CheckinCandidate, ids: ReadonlySet<string>): boolean {
  return b.status === 'pending' && !!b.replacesBookingId && ids.has(b.replacesBookingId)
}

/** Spec S7 counters over today's pending + confirmed (+ no-show) bookings; a change pair counts once (review R7). */
export function todayCounters(bookings: Array<CheckinCandidate & { partySize: number }>, now: HongKongMoment): TodayCounters {
  const c: TodayCounters = { guestsArrived: 0, guestsExpected: 0, waiting: 0, late: 0, noShow: 0 }
  const ids = new Set(bookings.flatMap((b) => (b.id ? [b.id] : [])))
  for (const b of bookings) {
    const state = arrivalState(b, now)
    if ((b.status === 'confirmed' || b.status === 'pending') && !pendingChangeOfListed(b, ids)) c.guestsExpected += b.partySize
    if (state.kind === 'arrived') c.guestsArrived += b.partySize
    if (state.kind === 'waiting' || state.kind === 'late') c.waiting += 1
    if (state.kind === 'late') c.late += 1
    if (state.kind === 'no_show') c.noShow += 1
  }
  return c
}

const digitsOf = (s: string) => s.replace(/\D/g, '')

/** Spec AC-20: one search over name (any part, any case) and phone (4+ digits, any spacing or +852). */
export function matchesTodaySearch(b: { name: string | null; phone: string | null }, query: string): boolean {
  const q = query.trim()
  if (q === '') return true
  if (b.name && b.name.toLowerCase().includes(q.toLowerCase())) return true
  const digits = digitsOf(q)
  // Decision 9 (AC-27): a booking without a phone is never a phone match.
  return digits.length >= 4 && b.phone !== null && digitsOf(b.phone).includes(digits)
}

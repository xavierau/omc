/**
 * BOOK-013 (spec S6/S7; threat R8, R10, R14, R15): the check-in code a
 * confirmed booking carries, the QR payload, the strict parse of a scanned or
 * typed code, and the Today view's arrival rules.
 *
 * The code uses the BOOK-003 confirm-code alphabet (no 0/O/1/I, at least one
 * digit) from a CSPRNG; the QR holds only `BK:<code>`, nothing about the
 * diner. A code is only ever looked up inside the session's restaurant.
 */
import { generateConfirmCode, isConfirmCode } from './booking-confirm-code'
import { absoluteMinutes } from './booking-calendar'
import { hongKongTime } from './booking-submission'
import type { HongKongMoment } from '@/domain/ports/booking'

export const CHECKIN_QR_PREFIX = 'BK:'
/** R8: codes the database tries in order when one clashes (unique per restaurant). */
export const CHECKIN_CODE_ATTEMPTS = 5
/** Spec S7: a waiting booking is "late" this many minutes after its time. */
export const LATE_AFTER_MINUTES = 15
/** R12: the most bookings one Today list returns; more sets `truncated`. */
export const TODAY_LIST_CAP = 300
/** R15: longer scanned/typed text is never a code. */
const SCAN_TEXT_MAX = 16

/** R10: the QR payload, exactly `BK:<code>`. */
export const checkinQrPayload = (code: string): string => `${CHECKIN_QR_PREFIX}${code}`

/** R8: `n` distinct codes; `randomIndex` is crypto.randomInt in production. */
export function newCheckinCodes(randomIndex: (n: number) => number, n: number = CHECKIN_CODE_ATTEMPTS): string[] {
  const codes = new Set<string>()
  while (codes.size < n) codes.add(generateConfirmCode(randomIndex))
  return [...codes]
}

/**
 * R15: `^(BK:)?<code>$`, case-insensitive, surrounding spaces ignored; anything
 * else (a URL, a coupon QR, script, long text) is null and never queried.
 */
export function parseCheckinCode(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > SCAN_TEXT_MAX + 4) return null
  const text = raw.trim().toUpperCase()
  if (text.length > SCAN_TEXT_MAX) return null
  const code = text.startsWith(CHECKIN_QR_PREFIX) ? text.slice(CHECKIN_QR_PREFIX.length) : text
  return isConfirmCode(code) ? code : null
}

export interface CheckinCandidate {
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

/** Spec S7 counters over today's pending + confirmed (+ no-show) bookings. */
export function todayCounters(bookings: Array<CheckinCandidate & { partySize: number }>, now: HongKongMoment): TodayCounters {
  const c: TodayCounters = { guestsArrived: 0, guestsExpected: 0, waiting: 0, late: 0, noShow: 0 }
  for (const b of bookings) {
    const state = arrivalState(b, now)
    if (b.status === 'confirmed' || b.status === 'pending') c.guestsExpected += b.partySize
    if (state.kind === 'arrived') c.guestsArrived += b.partySize
    if (state.kind === 'waiting' || state.kind === 'late') c.waiting += 1
    if (state.kind === 'late') c.late += 1
    if (state.kind === 'no_show') c.noShow += 1
  }
  return c
}

const digitsOf = (s: string) => s.replace(/\D/g, '')

/**
 * Spec AC-20: one search over name (any part, any case), phone (4+ digits,
 * any spacing or +852) and check-in code (a part of it, any case).
 */
export function matchesTodaySearch(b: { name: string | null; phone: string; checkinCode?: string | null }, query: string): boolean {
  const q = query.trim()
  if (q === '') return true
  const lower = q.toLowerCase()
  if (b.name && b.name.toLowerCase().includes(lower)) return true
  const digits = digitsOf(q)
  if (digits.length >= 4 && digitsOf(b.phone).includes(digits)) return true
  const code = q.toUpperCase().replace(/^BK:/, '')
  return !!b.checkinCode && code.length >= 2 && b.checkinCode.includes(code)
}

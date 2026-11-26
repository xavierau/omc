// BOOK-013 domain: the staff form as the server accepts it (R4, R7), the
// booking rules staff may override (AC-3, AC-8), the check-in code and QR
// payload (R8, R10, R15) and the Today view's arrival rules (AC-20, AC-22, R14).
import { describe, it, expect } from 'vitest'
import { parseStaffBookingInput, type StaffBookingContext } from '../staff-booking-input'
import { brokenRules, brokenRuleCodes } from '../staff-booking-rules'
import {
  arrivalState,
  canCheckIn,
  checkinQrPayload,
  matchesTodaySearch,
  newCheckinCodes,
  parseCheckinCode,
  todayCounters,
} from '../booking-checkin'
import { canMarkNoShow } from '../booking-no-show'
import { isConfirmCode } from '../booking-confirm-code'
import { EMPTY_BOOKING_HOURS, type BookingHours } from '@/domain/value-objects/booking-hours'
import type { RoomState } from '../booking-room'

// Thursday 2026-11-26 11:00 in Hong Kong.
const CLOCK = { today: '2026-11-26', nowTime: '11:00' }
const ctx = (extra: Partial<StaffBookingContext> = {}): StaffBookingContext => ({
  maxPartySize: 12,
  clock: CLOCK,
  normalizePhone: (raw) => (/^\+?[\d\s]{8,}$/.test(raw) ? `+852${raw.replace(/\D/g, '').slice(-8)}` : null),
  ...extra,
})
const valid = { phone: '9123 4567', name: '  Chan  Tai Man ', partySize: 4, date: '2026-11-28', time: '19:00', notes: ' window ' }

describe('parseStaffBookingInput (R4, R7)', () => {
  it('reads the allow-listed fields, normalises phone, name and notes; notify defaults on, override off', () => {
    expect(parseStaffBookingInput(valid, ctx())).toEqual({
      ok: true,
      expectedVersion: null,
      input: { phone: '+85291234567', name: 'Chan Tai Man', partySize: 4, date: '2026-11-28', time: '19:00', notes: 'window', notify: true, override: false },
    })
  })

  it('R4: status, source, member, code, restaurant and created_by in the body are ignored', () => {
    const r = parseStaffBookingInput({ ...valid, status: 'cancelled', source: 'agent', memberId: 'm-x', member_id: 'm-x', checkinCode: 'AAAAA2', restaurant_id: 'rest-b', createdBy: 'u-x' }, ctx())
    expect(r.ok && Object.keys(r.input).sort()).toEqual(['date', 'name', 'notes', 'notify', 'override', 'partySize', 'phone', 'time'])
  })

  it.each([
    ['phone missing', { phone: '' }, 'phone', 'required'],
    ['phone not a number', { phone: 'call me' }, 'phone', 'invalid'],
    ['name missing', { name: '   ' }, 'name', 'required'],
    ['name over 60', { name: 'x'.repeat(61) }, 'name', 'too_long'],
    ['party 0', { partySize: 0 }, 'partySize', 'invalid'],
    ['party 2.5', { partySize: 2.5 }, 'partySize', 'invalid'],
    ['party above max', { partySize: 13 }, 'partySize', 'above_max'],
    ['notes over 500', { notes: 'n'.repeat(501) }, 'notes', 'too_long'],
    ['not a date', { date: '2026-02-30' }, 'date', 'invalid'],
    ['not a time', { time: '7pm' }, 'time', 'invalid'],
    ['in the past', { date: '2026-11-26', time: '10:30' }, 'time', 'past'],
    ['notify not boolean', { notify: 'yes' }, 'notify', 'invalid'],
  ])('AC-4: %s is a field error', (_, patch, field, code) => {
    expect(parseStaffBookingInput({ ...valid, ...patch }, ctx())).toMatchObject({ ok: false, errors: { [field]: code } })
  })

  it('AC-4: override never lifts a field error', () => {
    expect(parseStaffBookingInput({ ...valid, partySize: 0, override: true }, ctx()).ok).toBe(false)
  })

  it('a non-object body is invalid_body', () => {
    for (const body of [null, 'x', [valid]]) expect(parseStaffBookingInput(body, ctx())).toEqual({ ok: false, errors: { form: 'invalid_body' } })
  })

  it('edit: expectedVersion is required (R3) and an unchanged past slot is allowed', () => {
    const edit = ctx({ requireExpectedVersion: true, currentSlot: { date: '2026-11-26', time: '10:00' } })
    expect(parseStaffBookingInput({ ...valid, date: '2026-11-26', time: '10:00' }, edit)).toMatchObject({ ok: false, errors: { expectedVersion: 'required' } })
    const ok = parseStaffBookingInput({ ...valid, date: '2026-11-26', time: '10:00', expectedVersion: 3 }, edit)
    expect(ok).toMatchObject({ ok: true, expectedVersion: 3 })
    expect(parseStaffBookingInput({ ...valid, date: '2026-11-26', time: '10:30', expectedVersion: 3 }, edit)).toMatchObject({ ok: false, errors: { time: 'past' } })
  })

  it.each([-1, 1.5, '3', null, 2 ** 31])('edit: expectedVersion %s is refused (a non-negative int4)', (v) => {
    const edit = ctx({ requireExpectedVersion: true })
    expect(parseStaffBookingInput({ ...valid, expectedVersion: v }, edit)).toMatchObject({ ok: false, errors: { expectedVersion: 'required' } })
  })
})

describe('brokenRules (AC-3, AC-8; owner decision 3: warn, never refuse)', () => {
  const dinner = [{ label: 'Dinner', first: '18:00', last: '21:00' }]
  const HOURS: BookingHours = {
    ...EMPTY_BOOKING_HOURS,
    weekly: { ...EMPTY_BOOKING_HOURS.weekly, sat: dinner, thu: dinner },
    limits: { perSlot: 10, perMeal: 20 },
  }
  const room = (counts: RoomState['counts'] = {}, stops: RoomState['stops'] = []): RoomState => ({ counts, stops })
  const req = (extra: Partial<{ date: string; time: string; partySize: number }> = {}) => ({ date: '2026-11-28', time: '19:00', partySize: 4, ...extra })

  it('inside the rules → none', () => {
    expect(brokenRules(HOURS, req(), room(), CLOCK)).toEqual([])
  })

  it('no active schedule → no rules apply', () => {
    expect(brokenRules({ ...HOURS, scheduleEnabled: false }, req({ time: '03:00' }), room(), CLOCK)).toEqual([])
    expect(brokenRules(null, req(), room(), CLOCK)).toEqual([])
  })

  it('lists every broken rule: closed day, outside hours, too soon, too far', () => {
    expect(brokenRuleCodes(brokenRules(HOURS, req({ date: '2026-11-27' }), room(), CLOCK))).toEqual(['closed_day'])
    expect(brokenRuleCodes(brokenRules(HOURS, req({ time: '22:00' }), room(), CLOCK))).toEqual(['outside_hours'])
    expect(brokenRuleCodes(brokenRules(HOURS, req({ date: '2026-11-26', time: '12:00' }), room(), CLOCK))).toContain('outside_hours')
    expect(brokenRuleCodes(brokenRules(HOURS, req({ date: '2027-01-30' }), room(), CLOCK))).toContain('too_far')
  })

  it('a stop and both guest limits are listed together with their numbers', () => {
    const stops = [{ date: '2026-11-28', scope: 'slot' as const, periodLabel: null, time: '19:00', stoppedById: 'u', stoppedByName: 'Amy', stoppedAt: '2026-11-26T00:00:00Z' }]
    const rules = brokenRules(HOURS, req(), room({ '2026-11-28': { '19:00': 8, '18:00': 10 } }, stops), CLOCK)
    expect(rules).toEqual([
      { code: 'stopped', scope: 'slot' },
      { code: 'slot_full', time: '19:00', guests: 8, limit: 10 },
      { code: 'meal_full', period: 'Dinner', guests: 18, limit: 20 },
    ])
  })

  it('AC-8: an edit does not count the booking against itself', () => {
    const counts = { '2026-11-28': { '19:00': 8 } }
    expect(brokenRules(HOURS, req({ partySize: 5 }), room(counts), CLOCK)).toHaveLength(1)
    expect(brokenRules(HOURS, req({ partySize: 5 }), room(counts), CLOCK, { date: '2026-11-28', time: '19:00', partySize: 4, counted: true })).toEqual([])
  })
})

describe('check-in code and QR (R8, R10, R15)', () => {
  it('R8: codes use the confirm-code alphabet and are distinct', () => {
    let i = 0
    const codes = newCheckinCodes((n) => (i++ * 7) % n)
    expect(codes).toHaveLength(5)
    expect(new Set(codes).size).toBe(5)
    for (const c of codes) expect(isConfirmCode(c)).toBe(true)
  })

  it('R10: the QR holds exactly BK:<code>', () => {
    expect(checkinQrPayload('K7Q2MX')).toBe('BK:K7Q2MX')
  })

  it.each([
    ['BK:K7Q2MX', 'K7Q2MX'], ['k7q2mx', 'K7Q2MX'], ['  bk:K7Q2MX ', 'K7Q2MX'],
  ])('R15: %j parses to %s', (raw, code) => {
    expect(parseCheckinCode(raw)).toBe(code)
  })

  it.each([
    'https://evil.example/BK:K7Q2MX', 'COUPON:ABC123', 'BK:K7Q2M', 'BK:K7Q2MXX', 'BK:K0Q2MX', 'BK:ABCDEF', '<script>', 'x'.repeat(200), 42, null,
  ])('R15: %j is not a code (never looked up)', (raw) => {
    expect(parseCheckinCode(raw)).toBeNull()
  })
})

describe('Today rules (AC-20, AC-22, R14)', () => {
  const today = '2026-11-26'
  const b = (extra: Record<string, unknown> = {}) => ({ status: 'confirmed', bookingDate: today, bookingTime: '19:00', checkedInAt: null, partySize: 2, ...extra })

  it('R14: Arrived only on today\'s confirmed, not arrived, no open change', () => {
    expect(canCheckIn(b(), today)).toBe(true)
    expect(canCheckIn(b({ bookingDate: '2026-11-27' }), today)).toBe(false)
    expect(canCheckIn(b({ status: 'pending' }), today)).toBe(false)
    expect(canCheckIn(b({ status: 'no_show' }), today)).toBe(false)
    expect(canCheckIn(b({ checkedInAt: '2026-11-26T11:00:00Z' }), today)).toBe(false)
    expect(canCheckIn(b({ openChange: { id: 'c' } }), today)).toBe(false)
  })

  it('R14: an arrived booking is never offered no-show', () => {
    const past = { status: 'confirmed', bookingDate: '2026-11-25', bookingTime: '19:00' }
    expect(canMarkNoShow(past, new Date('2026-11-26T03:00:00Z'))).toBe(true)
    expect(canMarkNoShow({ ...past, checkedInAt: '2026-11-25T11:00:00Z' }, new Date('2026-11-26T03:00:00Z'))).toBe(false)
  })

  it('states: Waiting, Late N min from 15, Arrived HH:MM (HK), No-show, Needs reply', () => {
    expect(arrivalState(b(), { date: today, time: '19:14' })).toEqual({ kind: 'waiting' })
    expect(arrivalState(b(), { date: today, time: '19:15' })).toEqual({ kind: 'late', minutes: 15 })
    expect(arrivalState(b({ checkedInAt: '2026-11-26T11:07:00Z' }), { date: today, time: '20:00' })).toEqual({ kind: 'arrived', at: '19:07' })
    expect(arrivalState(b({ status: 'no_show' }), { date: today, time: '20:00' })).toEqual({ kind: 'no_show' })
    expect(arrivalState(b({ status: 'pending' }), { date: today, time: '20:00' })).toEqual({ kind: 'needs_reply' })
  })

  it('counters: guests arrived of expected, waiting, late, no-show', () => {
    const list = [
      b({ partySize: 4, checkedInAt: '2026-11-26T10:00:00Z' }),
      b({ partySize: 2, bookingTime: '18:00' }),
      b({ partySize: 3, bookingTime: '20:00' }),
      b({ partySize: 5, status: 'no_show' }),
      b({ partySize: 2, status: 'pending' }),
    ]
    expect(todayCounters(list, { date: today, time: '18:30' })).toEqual({ guestsArrived: 4, guestsExpected: 11, waiting: 2, late: 1, noShow: 1 })
  })

  it('review R7: a BOOK-006 change pair (both today) counts once: the confirmed original, not its pending change', () => {
    const list = [
      b({ id: 'orig', partySize: 4, bookingTime: '19:00' }),
      b({ id: 'chg', partySize: 4, bookingTime: '20:00', status: 'pending', replacesBookingId: 'orig' }),
    ]
    expect(todayCounters(list, { date: today, time: '12:00' }).guestsExpected).toBe(4)
  })

  it('review R7: a pending change whose original is another day still counts (the party is not otherwise in today)', () => {
    const list = [b({ id: 'chg', partySize: 4, status: 'pending', replacesBookingId: 'orig-other-day' })]
    expect(todayCounters(list, { date: today, time: '12:00' }).guestsExpected).toBe(4)
  })

  it('AC-20: one search over name, 4+ phone digits (any spacing) and code', () => {
    const row = { name: 'Chan Tai Man', phone: '+85291234567', checkinCode: 'K7Q2MX' }
    expect(matchesTodaySearch(row, 'tai')).toBe(true)
    expect(matchesTodaySearch(row, '9123 4567')).toBe(true)
    expect(matchesTodaySearch(row, '4567')).toBe(true)
    expect(matchesTodaySearch(row, '456')).toBe(false)
    expect(matchesTodaySearch(row, 'k7q2')).toBe(true)
    expect(matchesTodaySearch(row, 'BK:K7Q2MX')).toBe(true)
    expect(matchesTodaySearch(row, 'wong')).toBe(false)
    expect(matchesTodaySearch(row, '')).toBe(true)
  })
})

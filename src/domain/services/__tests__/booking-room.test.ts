// BOOK-010 AC-1 (domain): "is there room" for a party (spec S2), suggestions
// that skip full slots (AC-4), stops at day / period / slot (AC-8, AC-9),
// staff capacity (S3), and no limits = BOOK-009 unchanged (AC-3).
// Clock: Fri 2026-11-20 10:00 HK; 2026-11-21 is a Saturday.
import { describe, it, expect } from 'vitest'
import { EMPTY_BOOKING_HOURS, type BookingHours } from '@/domain/value-objects/booking-hours'
import { slotsFor, suggestTimes } from '@/domain/services/booking-hours'
import {
  EMPTY_ROOM,
  availableTimes,
  fitsFor,
  periodKey,
  roomCheckFor,
  roomFor,
  type BookingStop,
  type RoomState,
} from '@/domain/services/booking-room'
import { capacityBadge, capacityDay } from '@/domain/services/booking-capacity'

const CLOCK = { today: '2026-11-20', nowTime: '10:00' }
const DAY = '2026-11-21'
const lunchDinner = [
  { label: '午市', first: '12:00', last: '14:00' },
  { label: '晚市', first: '18:00', last: '21:30' },
]
const BASE: BookingHours = {
  ...EMPTY_BOOKING_HOURS,
  weekly: { mon: lunchDinner, tue: lunchDinner, wed: lunchDinner, thu: lunchDinner, fri: lunchDinner, sat: lunchDinner, sun: lunchDinner },
  intervalMinutes: 30,
  noticeHours: 2,
  aheadDays: 30,
}
const LIMITED: BookingHours = { ...BASE, limits: { perSlot: 30, perMeal: 60 } }

const room = (counts: RoomState['counts'] = {}, stops: BookingStop[] = []): RoomState => ({ counts, stops })
const stop = (patch: Partial<BookingStop> & Pick<BookingStop, 'scope'>): BookingStop => ({
  date: DAY, periodLabel: null, time: null, stoppedById: 'u1', stoppedByName: 'Amy', stoppedAt: '2026-11-20T06:02:00.000Z', ...patch,
})
const ask = (time: string, partySize: number, date = DAY) => ({ date, time, partySize })

describe('roomFor: guest limits (spec S2)', () => {
  it('AC-4: 28 guests at 19:00 with a slot limit of 30 → a party of 4 does not fit; a party of 2 does', () => {
    const r = room({ [DAY]: { '19:00': 28 } })
    expect(roomFor(LIMITED, ask('19:00', 4), r)).toEqual({ kind: 'full', scope: 'slot', guests: 28, limit: 30 })
    expect(roomFor(LIMITED, ask('19:00', 2), r)).toBeNull()
  })

  it('the meal limit counts every slot of the period on that date, and only that period', () => {
    const r = room({ [DAY]: { '18:00': 20, '19:00': 20, '21:30': 18, '12:00': 30 } })
    expect(roomFor(LIMITED, ask('20:00', 3), r)).toEqual({ kind: 'full', scope: 'meal', guests: 58, limit: 60 })
    expect(roomFor(LIMITED, ask('20:00', 2), r)).toBeNull()
    expect(roomFor(LIMITED, ask('13:00', 20), r)).toBeNull()
  })

  it('another date never counts', () => {
    expect(roomFor(LIMITED, ask('19:00', 4), room({ '2026-11-22': { '19:00': 30 } }))).toBeNull()
  })

  it('AC-3: no limits set → any count fits (BOOK-009 behaviour)', () => {
    expect(roomFor(BASE, ask('19:00', 20), room({ [DAY]: { '19:00': 999 } }))).toBeNull()
    expect(roomFor({ ...BASE, limits: { perSlot: null, perMeal: null } }, ask('19:00', 20), room({ [DAY]: { '19:00': 999 } }))).toBeNull()
  })

  it('one limit only: slot only, meal only', () => {
    const r = room({ [DAY]: { '19:00': 29, '18:00': 40 } })
    expect(roomFor({ ...BASE, limits: { perSlot: 30, perMeal: null } }, ask('19:00', 2), r)).toMatchObject({ scope: 'slot' })
    expect(roomFor({ ...BASE, limits: { perSlot: null, perMeal: 70 } }, ask('19:30', 2), r)).toMatchObject({ scope: 'meal', guests: 69 })
  })
})

describe('roomFor: staff stops (spec AC-8, AC-9)', () => {
  it('AC-8: 晚市 stopped → dinner times refused, lunch unaffected', () => {
    const r = room({}, [stop({ scope: 'period', periodLabel: '晚市' })])
    expect(roomFor(BASE, ask('19:00', 1), r)).toEqual({ kind: 'stopped', scope: 'period' })
    expect(roomFor(BASE, ask('12:30', 1), r)).toBeNull()
  })

  it('AC-9: the whole day stopped → every time refused, other dates open', () => {
    const r = room({}, [stop({ scope: 'day' })])
    expect(roomFor(BASE, ask('12:00', 1), r)).toEqual({ kind: 'stopped', scope: 'day' })
    expect(roomFor(BASE, ask('12:00', 1, '2026-11-22'), r)).toBeNull()
  })

  it('a slot stop closes only that time', () => {
    const r = room({}, [stop({ scope: 'slot', time: '19:00' })])
    expect(roomFor(BASE, ask('19:00', 1), r)).toEqual({ kind: 'stopped', scope: 'slot' })
    expect(roomFor(BASE, ask('19:30', 1), r)).toBeNull()
  })

  it('a period without a label is keyed by its range', () => {
    const plain: BookingHours = { ...BASE, weekly: { ...BASE.weekly, sat: [{ first: '18:00', last: '21:00' }] } }
    expect(periodKey({ first: '18:00', last: '21:00' })).toBe('18:00-21:00')
    expect(roomFor(plain, ask('19:00', 1), room({}, [stop({ scope: 'period', periodLabel: '18:00-21:00' })]))).toMatchObject({ kind: 'stopped' })
  })
})

describe('roomCheckFor: what the database function gets', () => {
  it('period key and range plus the limits', () => {
    expect(roomCheckFor(LIMITED, DAY, '19:00')).toEqual({ periodKey: '晚市', periodFirst: '18:00', periodLast: '21:30', perSlot: 30, perMeal: 60 })
    expect(roomCheckFor(BASE, DAY, '03:00')).toEqual({ periodKey: null, periodFirst: null, periodLast: null, perSlot: null, perMeal: null })
  })
})

describe('suggestions and availability for a party size (spec AC-4, AC-12, AC-14)', () => {
  it('AC-4: suggestions skip slots that cannot take the party, nearest first', () => {
    const slotOnly: BookingHours = { ...BASE, limits: { perSlot: 30, perMeal: null } }
    const r = room({ [DAY]: { '19:00': 28, '18:30': 27, '19:30': 26 } })
    const fits = fitsFor(slotOnly, r, 4)
    expect(suggestTimes(slotOnly, DAY, '19:00', CLOCK, 3, fits)).toEqual([
      { date: DAY, time: '19:30' },
      { date: DAY, time: '18:00' },
      { date: DAY, time: '20:00' },
    ])
  })

  it('AC-3: without a predicate suggestions are exactly BOOK-009’s', () => {
    expect(suggestTimes(LIMITED, DAY, '19:00', CLOCK, 3, fitsFor(BASE, EMPTY_ROOM, 4))).toEqual(suggestTimes(BASE, DAY, '19:00', CLOCK))
  })

  it('AC-14: available times drop full and stopped slots; party size changes the answer', () => {
    const r = room({ [DAY]: { '19:00': 28 } }, [stop({ scope: 'period', periodLabel: '午市' })])
    const for4 = availableTimes(LIMITED, DAY, CLOCK, fitsFor(LIMITED, r, 4))
    expect(for4).not.toContain('19:00')
    expect(for4).not.toContain('12:00')
    expect(for4).toContain('18:30')
    expect(availableTimes(LIMITED, DAY, CLOCK, fitsFor(LIMITED, r, 2))).toContain('19:00')
  })

  it('AC-3: no limits and no stops → availability equals BOOK-009 slots', () => {
    expect(availableTimes(BASE, DAY, CLOCK, fitsFor(BASE, EMPTY_ROOM, 8))).toEqual(slotsFor(BASE, DAY, CLOCK).map((s) => s.time))
  })
})

describe('staff capacity (spec S3)', () => {
  it('per period guests / limit and per slot full, with who stopped what', () => {
    const r = room({ [DAY]: { '19:00': 30, '18:00': 10, '12:00': 4 } }, [stop({ scope: 'slot', time: '20:00' })])
    const day = capacityDay(LIMITED, DAY, r)
    expect(day).toMatchObject({ date: DAY, stopped: false, full: false })
    const dinner = day.periods.find((p) => p.key === '晚市')
    expect(dinner).toMatchObject({ label: '晚市', first: '18:00', last: '21:30', guests: 40, limit: 60, full: false, stopped: false })
    expect(dinner?.slots.find((s) => s.time === '19:00')).toMatchObject({ guests: 30, limit: 30, full: true, stopped: false })
    expect(dinner?.slots.find((s) => s.time === '20:00')).toMatchObject({ full: false, stopped: true, stoppedBy: 'Amy', stoppedAt: '2026-11-20T06:02:00.000Z' })
    expect(day.periods.find((p) => p.key === '午市')).toMatchObject({ guests: 4, slots: expect.any(Array) })
  })

  it('AC-9: month badges: stopped day; full when no slot fits a party of 1; closed day is neither', () => {
    expect(capacityBadge(BASE, DAY, room({}, [stop({ scope: 'day' })]))).toEqual({ full: true, stopped: true })
    const both = room({}, [stop({ scope: 'period', periodLabel: '午市' }), stop({ scope: 'period', periodLabel: '晚市' })])
    expect(capacityBadge(BASE, DAY, both)).toEqual({ full: true, stopped: false })
    expect(capacityBadge(LIMITED, DAY, room({ [DAY]: { '12:00': 60, '18:00': 60 } }))).toEqual({ full: true, stopped: false })
    expect(capacityBadge(LIMITED, DAY, room({ [DAY]: { '12:00': 60 } }))).toEqual({ full: false, stopped: false })
    const closed: BookingHours = { ...BASE, weekly: { ...BASE.weekly, sat: [] } }
    expect(capacityBadge(closed, DAY, EMPTY_ROOM)).toEqual({ full: false, stopped: false })
  })
})

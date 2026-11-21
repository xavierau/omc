// BOOK-010 I-010: room rules follow BOOK-009's schedule switch (W1 decision
// (a)), and the staff slot badge tells "this slot is full" apart from "the
// meal is full" (main review of W2 evidence 05r).
import { describe, it, expect } from 'vitest'
import { EMPTY_BOOKING_HOURS, type BookingHours } from '@/domain/value-objects/booking-hours'
import { roomApplies, type BookingStop, type RoomState } from '@/domain/services/booking-room'
import { capacityDay, mealReached, slotBadge } from '@/domain/services/booking-capacity'

const DAY = '2026-11-21'
const lunchDinner = [
  { label: '午市', first: '12:00', last: '14:00' },
  { label: '晚市', first: '18:00', last: '21:30' },
]
const LIMITED: BookingHours = {
  ...EMPTY_BOOKING_HOURS,
  weekly: { mon: lunchDinner, tue: lunchDinner, wed: lunchDinner, thu: lunchDinner, fri: lunchDinner, sat: lunchDinner, sun: lunchDinner },
  limits: { perSlot: 30, perMeal: 60 },
}
const OFF: BookingHours = { ...LIMITED, scheduleEnabled: false }
const room = (counts: RoomState['counts'] = {}, stops: BookingStop[] = []): RoomState => ({ counts, stops })
const stopAt = (time: string): BookingStop => ({
  date: DAY, scope: 'slot', periodLabel: null, time, stoppedById: 'u1', stoppedByName: 'Amy', stoppedAt: '2026-11-21T06:02:00.000Z',
})

describe('roomApplies follows the schedule switch', () => {
  it('no hours → no room rules (AC-3)', () => {
    expect(roomApplies(null)).toBe(false)
    expect(roomApplies(undefined)).toBe(false)
  })

  it('schedule on → room rules apply', () => {
    expect(roomApplies(LIMITED)).toBe(true)
  })

  it('schedule off → no room rules, even with limits stored', () => {
    expect(roomApplies(OFF)).toBe(false)
  })
})

describe('staff slot badge: slot full vs meal full', () => {
  const dinner = (counts: RoomState['counts'], stops: BookingStop[] = []) =>
    capacityDay(LIMITED, DAY, room(counts, stops)).periods.find((p) => p.key === '晚市')!

  it('meal limit reached with 0 at a slot → that slot reads meal full, never full', () => {
    const p = dinner({ [DAY]: { '18:00': 30, '19:00': 30 } })
    expect(mealReached(p)).toBe(true)
    const empty = p.slots.find((s) => s.time === '20:00')!
    expect(empty.guests).toBe(0)
    expect(slotBadge(p, empty)).toBe('meal_full')
  })

  it("a slot at its own limit reads full, also when the meal is full", () => {
    const p = dinner({ [DAY]: { '18:00': 30, '19:00': 30 } })
    expect(slotBadge(p, p.slots.find((s) => s.time === '19:00')!)).toBe('full')
  })

  it('a stopped slot reads full', () => {
    const p = dinner({ [DAY]: { '19:00': 2 } }, [stopAt('19:30')])
    expect(mealReached(p)).toBe(false)
    expect(slotBadge(p, p.slots.find((s) => s.time === '19:30')!)).toBe('full')
  })

  it('room left in the slot and the meal → no badge', () => {
    const p = dinner({ [DAY]: { '19:00': 12 } })
    expect(mealReached(p)).toBe(false)
    expect(slotBadge(p, p.slots.find((s) => s.time === '19:00')!)).toBeNull()
  })

  it('no meal limit → never meal full', () => {
    const hours = { ...LIMITED, limits: { perSlot: 30, perMeal: null } }
    const p = capacityDay(hours, DAY, room({ [DAY]: { '19:00': 500 } })).periods.find((x) => x.key === '晚市')!
    expect(mealReached(p)).toBe(false)
  })
})

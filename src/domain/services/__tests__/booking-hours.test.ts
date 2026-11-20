// BOOK-009 AC-1 (plan D2): the pure booking-hours service every channel
// shares. Hong Kong time only. 2026-11-20 is a Friday; 2026-11-23 a Monday.
import { describe, it, expect } from 'vitest'
import { checkSlot, slotsFor, suggestTimes } from '../booking-hours'
import type { BookingHours, BookingPeriod } from '@/domain/value-objects/booking-hours'

const LUNCH: BookingPeriod = { label: '午市', first: '12:00', last: '14:00' }
const DINNER: BookingPeriod = { label: '晚市', first: '18:00', last: '21:30' }
const OPEN = [LUNCH, DINNER]

function hours(patch: Partial<BookingHours> = {}): BookingHours {
  return {
    weekly: { mon: [], tue: OPEN, wed: OPEN, thu: OPEN, fri: OPEN, sat: OPEN, sun: OPEN },
    intervalMinutes: 30,
    noticeHours: 2,
    aheadDays: 30,
    special: [],
    tableMinutes: null,
    terms: { zh_hk: '', en: '' },
    info: { address: '', phone: '', mapUrl: '' },
    ...patch,
  }
}

const ctx = (nowTime = '10:00', today = '2026-11-20') => ({ today, nowTime })
const times = (h: BookingHours, date: string, c = ctx()) => slotsFor(h, date, c).map((s) => s.time)

describe('slotsFor', () => {
  it('steps from the first booking time by the interval up to the last, inclusive, labelled by period', () => {
    const slots = slotsFor(hours(), '2026-11-24', ctx())
    expect(slots.map((s) => s.time)).toEqual([
      '12:00', '12:30', '13:00', '13:30', '14:00',
      '18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00', '21:30',
    ])
    expect(slots[0]).toEqual({ time: '12:00', label: '午市' })
    expect(slots[5]).toEqual({ time: '18:00', label: '晚市' })
  })

  it('an unlabelled period gives label null', () => {
    const h = hours({ weekly: { ...hours().weekly, tue: [{ first: '18:00', last: '18:30' }] } })
    expect(slotsFor(h, '2026-11-24', ctx())).toEqual([{ time: '18:00', label: null }, { time: '18:30', label: null }])
  })

  it.each([
    [15, ['12:00', '12:15', '12:30', '12:45', '13:00', '13:15', '13:30', '13:45', '14:00']],
    [60, ['12:00', '13:00', '14:00']],
  ] as const)('interval %i minutes', (intervalMinutes, expected) => {
    const h = hours({ intervalMinutes, weekly: { ...hours().weekly, tue: [LUNCH] } })
    expect(times(h, '2026-11-24')).toEqual(expected)
  })

  it('a last time off the grid is not offered (60 min from 18:00 to 21:30)', () => {
    const h = hours({ intervalMinutes: 60, weekly: { ...hours().weekly, tue: [DINNER] } })
    expect(times(h, '2026-11-24')).toEqual(['18:00', '19:00', '20:00', '21:00'])
  })

  it('a closed weekday has no slots', () => {
    expect(times(hours(), '2026-11-23')).toEqual([])
  })

  it('AC-4: a special date overrides the weekly rule, closed or with its own periods', () => {
    const h = hours({
      aheadDays: 60,
      special: [
        { date: '2026-12-25', label: '聖誕', periods: [] },
        { date: '2026-11-23', periods: [{ first: '19:00', last: '20:00' }] },
      ],
    })
    expect(times(h, '2026-12-25')).toEqual([])
    expect(times(h, '2026-12-24')).toHaveLength(13)
    expect(times(h, '2026-11-23')).toEqual(['19:00', '19:30', '20:00'])
  })

  it('minimum notice: now 11:00 + 2 h keeps 13:00 on; 11:01 drops it', () => {
    expect(times(hours(), '2026-11-20', ctx('11:00'))[0]).toBe('13:00')
    expect(times(hours(), '2026-11-20', ctx('11:01'))[0]).toBe('13:30')
  })

  it('no notice still needs a time later than now', () => {
    const h = hours({ noticeHours: 0 })
    expect(times(h, '2026-11-20', ctx('12:00'))[0]).toBe('12:30')
  })

  it('notice runs past midnight into the next day', () => {
    expect(times(hours({ noticeHours: 12 }), '2026-11-21', ctx('23:00'))[0]).toBe('12:00')
    expect(times(hours({ noticeHours: 24 }), '2026-11-21', ctx('13:00'))[0]).toBe('13:00')
    expect(times(hours({ noticeHours: 24 }), '2026-11-21', ctx('13:01'))[0]).toBe('13:30')
  })

  it('booking window: today + aheadDays is the last bookable date; past dates have none', () => {
    expect(times(hours(), '2026-12-20')).toHaveLength(13)
    expect(times(hours(), '2026-12-21')).toEqual([])
    expect(times(hours({ aheadDays: 7 }), '2026-11-28')).toEqual([])
    expect(times(hours(), '2026-11-19')).toEqual([])
  })
})

describe('checkSlot', () => {
  const h = hours({ special: [{ date: '2026-12-15', periods: [] }] })

  it.each([
    ['a valid slot', '2026-11-24', '19:30', null],
    ['a closed weekday', '2026-11-23', '19:30', 'closed_day'],
    ['a special closed date on an open weekday', '2026-12-15', '19:30', 'closed_day'],
    ['a time off the slot grid', '2026-11-24', '19:15', 'outside_hours'],
    ['a time between periods', '2026-11-24', '15:00', 'outside_hours'],
    ['after the last booking time', '2026-11-24', '22:00', 'outside_hours'],
    ['exactly the minimum notice (now 10:00 + 2 h)', '2026-11-20', '12:00', null],
    ['past the booking window', '2026-12-21', '19:30', 'too_far'],
    ['a date already past', '2026-11-19', '19:30', 'too_soon'],
  ] as const)('%s → %s', (_label, date, time, code) => {
    expect(checkSlot(h, date, time, ctx())).toBe(code)
  })

  it('inside the minimum notice → too_soon; the boundary itself is accepted', () => {
    expect(checkSlot(h, '2026-11-20', '13:00', ctx('11:00'))).toBeNull()
    expect(checkSlot(h, '2026-11-20', '13:00', ctx('11:01'))).toBe('too_soon')
    expect(checkSlot(h, '2026-11-21', '12:00', ctx('23:00', '2026-11-20'))).toBeNull()
    expect(checkSlot({ ...h, noticeHours: 24 }, '2026-11-21', '12:00', ctx('12:01'))).toBe('too_soon')
  })
})

describe('suggestTimes', () => {
  it('same date first, nearest first (ties: the earlier time)', () => {
    expect(suggestTimes(hours(), '2026-11-24', '15:00', ctx())).toEqual([
      { date: '2026-11-24', time: '14:00' },
      { date: '2026-11-24', time: '13:30' },
      { date: '2026-11-24', time: '13:00' },
    ])
    expect(suggestTimes(hours(), '2026-11-24', '19:15', ctx())).toEqual([
      { date: '2026-11-24', time: '19:00' },
      { date: '2026-11-24', time: '19:30' },
      { date: '2026-11-24', time: '18:30' },
    ])
  })

  it('a closed day suggests the next open dates, nearest to the asked time', () => {
    expect(suggestTimes(hours(), '2026-11-23', '19:00', ctx())).toEqual([
      { date: '2026-11-24', time: '19:00' },
      { date: '2026-11-24', time: '18:30' },
      { date: '2026-11-24', time: '19:30' },
    ])
  })

  it('too soon today offers the first slots past the notice', () => {
    expect(suggestTimes(hours(), '2026-11-20', '12:00', ctx('11:00'))).toEqual([
      { date: '2026-11-20', time: '13:00' },
      { date: '2026-11-20', time: '13:30' },
      { date: '2026-11-20', time: '14:00' },
    ])
  })

  it('fills from following dates when the date has too few, and honours n', () => {
    const h = hours({ weekly: { ...hours().weekly, tue: [{ first: '20:00', last: '20:00' }] } })
    expect(suggestTimes(h, '2026-11-24', '19:00', ctx(), 2)).toEqual([
      { date: '2026-11-24', time: '20:00' },
      { date: '2026-11-25', time: '19:00' },
    ])
  })

  it('stays inside the window, so it may return fewer than n', () => {
    const h = hours({ aheadDays: 7, weekly: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] } })
    expect(suggestTimes(h, '2026-11-21', '19:00', ctx())).toEqual([])
    const lastDayOnly = hours({ aheadDays: 7, weekly: { ...h.weekly, fri: [{ first: '19:00', last: '19:00' }] } })
    expect(suggestTimes(lastDayOnly, '2026-11-26', '19:00', ctx())).toEqual([{ date: '2026-11-27', time: '19:00' }])
  })

  it('a date past the window has nothing to suggest', () => {
    expect(suggestTimes(hours(), '2026-12-21', '19:00', ctx())).toEqual([])
  })
})

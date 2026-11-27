import { describe, it, expect } from 'vitest'
import {
  DEFAULT_TODAY_SORT,
  defaultTodaySortDir,
  nextTodaySort,
  sortTodayBookings,
  todayMealGroups,
  type TodaySortable,
} from '../booking-today-sort'

// 19:10 in Hong Kong on the list's day: 18:30 is late (40 min), 19:00 still waiting (10 min).
const NOW = { date: '2026-11-21', time: '19:10' }

const row = (id: string, time: string, name: string | null, partySize: number, extra: Partial<TodaySortable> = {}): TodaySortable & { id: string } => ({
  id,
  name,
  partySize,
  bookingDate: '2026-11-21',
  bookingTime: time,
  status: 'confirmed',
  checkedInAt: null,
  ...extra,
})

const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id)

// a: 12:30 arrived · b: 18:30 late · c: 19:00 waiting · d: 20:30 pending (needs reply) · e: 17:00 no-show
const LIST = [
  row('c', '19:00', 'Mr Chan', 6),
  row('d', '20:30', 'Chan Ka Wai', 4, { status: 'pending' }),
  row('a', '12:30', 'Au Siu Fung', 2, { checkedInAt: '2026-11-21T04:27:00Z' }),
  row('e', '17:00', 'Lam Tai', 3, { status: 'no_show' }),
  row('b', '18:30', 'Wong Wing Yan', 2),
]

const sort = (key: 'time' | 'name' | 'guests' | 'status', dir: 'asc' | 'desc', list = LIST, locale = 'en') =>
  ids(sortTodayBookings(list, { key, dir }, { now: NOW, locale }))

describe('Today sort (BOOK-013 AC-25)', () => {
  it('defaults to time, earliest first', () => {
    expect(DEFAULT_TODAY_SORT).toEqual({ key: 'time', dir: 'asc' })
    expect(sort('time', 'asc')).toEqual(['a', 'e', 'b', 'c', 'd'])
  })

  it('time reversed is latest first', () => {
    expect(sort('time', 'desc')).toEqual(['d', 'c', 'b', 'e', 'a'])
  })

  it('name A to Z and reversed', () => {
    expect(sort('name', 'asc')).toEqual(['a', 'd', 'e', 'c', 'b'])
    expect(sort('name', 'desc')).toEqual(['b', 'c', 'e', 'd', 'a'])
  })

  it('guests start largest first; reversed is smallest first', () => {
    expect(defaultTodaySortDir('guests')).toBe('desc')
    expect(sort('guests', 'desc')).toEqual(['c', 'd', 'e', 'a', 'b'])
    expect(sort('guests', 'asc')).toEqual(['a', 'b', 'e', 'd', 'c'])
  })

  it('status orders Late, Waiting, Needs reply, Arrived, No-show; reversed the other way', () => {
    expect(sort('status', 'asc')).toEqual(['b', 'c', 'd', 'a', 'e'])
    expect(sort('status', 'desc')).toEqual(['e', 'a', 'd', 'c', 'b'])
  })

  it('ties fall back to time, then name (both ascending, whatever the direction)', () => {
    const tied = [
      row('x', '19:00', 'Yip', 2),
      row('y', '18:00', 'Zhang', 2),
      row('z', '19:00', 'Ho', 2),
    ]
    expect(sort('guests', 'desc', tied)).toEqual(['y', 'z', 'x'])
    expect(sort('guests', 'asc', tied)).toEqual(['y', 'z', 'x'])
    expect(sort('time', 'desc', tied)).toEqual(['z', 'x', 'y'])
  })

  it('zh-HK names follow the zh-HK collation (stroke order), not code points', () => {
    const zh = [row('1', '19:00', '陳生', 2), row('2', '19:00', '王太', 2), row('3', '19:00', '黃先生', 2), row('4', '19:00', '李小姐', 2)]
    expect(sort('name', 'asc', zh, 'zh-HK')).toEqual(['2', '4', '1', '3'])
    expect(sort('name', 'asc', zh, 'en')).not.toEqual(['2', '4', '1', '3'])
  })

  it('a booking with no name sorts after the named ones in both directions', () => {
    const list = [row('n', '19:00', null, 2), row('m', '19:00', 'Mak', 2), row('k', '19:00', 'Kwok', 2)]
    expect(sort('name', 'asc', list)).toEqual(['k', 'm', 'n'])
    expect(sort('name', 'desc', list)).toEqual(['m', 'k', 'n'])
  })

  it('never changes the list it was given', () => {
    const copy = [...LIST]
    sort('name', 'desc')
    expect(LIST).toEqual(copy)
  })

  it('selecting the active key reverses it; another key starts at its own default', () => {
    expect(nextTodaySort({ key: 'time', dir: 'asc' }, 'time')).toEqual({ key: 'time', dir: 'desc' })
    expect(nextTodaySort({ key: 'time', dir: 'desc' }, 'time')).toEqual({ key: 'time', dir: 'asc' })
    expect(nextTodaySort({ key: 'time', dir: 'desc' }, 'guests')).toEqual({ key: 'guests', dir: 'desc' })
    expect(nextTodaySort({ key: 'guests', dir: 'desc' }, 'name')).toEqual({ key: 'name', dir: 'asc' })
    expect(nextTodaySort({ key: 'name', dir: 'asc' }, 'status')).toEqual({ key: 'status', dir: 'asc' })
  })
})

describe('Today meal groups (shown only when sorted by time)', () => {
  it('splits a time-sorted list into Lunch (before 16:00) and Dinner, keeping the order', () => {
    const sorted = sortTodayBookings(LIST, DEFAULT_TODAY_SORT, { now: NOW, locale: 'en' })
    const groups = todayMealGroups(sorted)
    expect(groups.map((g) => [g.meal, ids(g.bookings)])).toEqual([
      ['lunch', ['a']],
      ['dinner', ['e', 'b', 'c', 'd']],
    ])
  })

  it('reversed time keeps the groups in list order (Dinner first) and drops an empty meal', () => {
    const sorted = sortTodayBookings(LIST, { key: 'time', dir: 'desc' }, { now: NOW, locale: 'en' })
    expect(todayMealGroups(sorted).map((g) => g.meal)).toEqual(['dinner', 'lunch'])
    expect(todayMealGroups(sorted.filter((b) => b.id !== 'a')).map((g) => g.meal)).toEqual(['dinner'])
    expect(todayMealGroups([])).toEqual([])
  })
})

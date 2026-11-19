import { describe, it, expect, vi, afterEach } from 'vitest'
import { addDays, gridRange, monthGrid, shiftMonth, todayInHongKong, weekOf } from '../bookings/booking-dates'
import { bookingsOn, chipName, covers, daySummary, filterBookings, groupByDay, matchesSearch, statusCounts } from '../bookings/booking-groups'
import { fetchRange, resolveView, SHOW_PENDING, stepSelected, storeView, readStoredView, tableOrder, tableRangeDates } from '../bookings/bookings-view-state'
import type { BookingItem } from '@/hooks/use-bookings'

const b = (id: string, date: string, time: string, status: BookingItem['status'], partySize = 2, extra: Partial<BookingItem> = {}): BookingItem => ({
  id, restaurantId: 'r', memberId: null, phone: '+852 9123 4567', name: 'Chan Tai Man', partySize, bookingDate: date,
  bookingTime: time, notes: null, status, declineReason: null, decidedBy: null, decidedAt: null, source: 'chat',
  campaignId: null, createdAt: '2026-11-01T00:00:00Z', decisionMessageStatus: null, ...extra,
})

afterEach(() => vi.unstubAllGlobals())

describe('booking dates (weeks start Sunday, HK today)', () => {
  it('November 2026 starts Sun 1 Nov and has 5 rows ending Sat 5 Dec', () => {
    const grid = monthGrid('2026-11-21')
    expect(grid).toHaveLength(5)
    expect(grid[0][0]).toBe('2026-11-01')
    expect(grid[4]).toEqual(['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05'])
    expect(gridRange('2026-11-21')).toEqual({ from: '2026-11-01', to: '2026-12-05' })
  })

  it('a month needing 6 rows gets 6 (Aug 2026: Sat 1st, Mon 31st), leading days from the month before', () => {
    const grid = monthGrid('2026-08-15')
    expect(grid).toHaveLength(6)
    expect(grid[0][0]).toBe('2026-07-26')
    expect(grid[5][6]).toBe('2026-09-05')
  })

  it('every grid row is Sunday..Saturday', () => {
    for (const week of monthGrid('2027-02-10')) expect(new Date(`${week[0]}T00:00:00Z`).getUTCDay()).toBe(0)
  })

  it('week of a date and month shifts cross year boundaries', () => {
    expect(weekOf('2026-11-19')).toEqual(['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21'])
    expect(shiftMonth('2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftMonth('2026-01-31', -1)).toBe('2025-12-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })

  it("today is Hong Kong's date, not the server's UTC date", () => {
    expect(todayInHongKong(new Date('2026-11-19T17:30:00Z'))).toBe('2026-11-20')
    expect(todayInHongKong(new Date('2026-11-19T15:59:00Z'))).toBe('2026-11-19')
  })
})

describe('booking groups', () => {
  const list = [
    b('late', '2026-11-21', '19:30', 'pending', 4),
    b('early', '2026-11-21', '12:30', 'confirmed', 2, { name: 'Au Ka Yan', phone: '+852 6123 4455' }),
    b('declined', '2026-11-21', '20:30', 'declined', 6),
    b('next', '2026-11-24', '19:30', 'pending', 2),
    b('prev', '2026-11-20', '20:00', 'confirmed', 3),
  ]

  it('groups by day soonest first, times ascending; past view newest first', () => {
    const asc = groupByDay(list, 'asc')
    expect(asc.map((g) => g.date)).toEqual(['2026-11-20', '2026-11-21', '2026-11-24'])
    expect(asc[1].bookings.map((x) => x.id)).toEqual(['early', 'late', 'declined'])
    const desc = groupByDay(list, 'desc')
    expect(desc.map((g) => g.date)).toEqual(['2026-11-24', '2026-11-21', '2026-11-20'])
    expect(desc[1].bookings.map((x) => x.id)).toEqual(['declined', 'late', 'early'])
  })

  it('covers sum party sizes and leave declined bookings out', () => {
    expect(covers(bookingsOn(list, '2026-11-21'))).toBe(6)
    expect(daySummary(bookingsOn(list, '2026-11-21'))).toEqual({ count: 3, guests: 6, pending: 1 })
  })

  it('status filter keeps only that status; all keeps everything', () => {
    expect(filterBookings(list, 'pending', '').map((x) => x.id)).toEqual(['late', 'next'])
    expect(filterBookings(list, 'all', '')).toHaveLength(5)
    expect(statusCounts(list)).toEqual({ all: 5, pending: 2, confirmed: 2, declined: 1 })
  })

  it('search: name case-insensitive, phone by digits whatever the spacing', () => {
    expect(matchesSearch(list[1], 'ka yan')).toBe(true)
    expect(matchesSearch(list[1], 'AU KA')).toBe(true)
    expect(matchesSearch(list[1], '61234455')).toBe(true)
    expect(matchesSearch(list[1], '6123 44')).toBe(true)
    expect(matchesSearch(list[1], '9999')).toBe(false)
    expect(matchesSearch(list[1], 'wong')).toBe(false)
    expect(matchesSearch(list[1], '  ')).toBe(true)
    expect(filterBookings(list, 'confirmed', '4455').map((x) => x.id)).toEqual(['early'])
  })

  it('a purged name never matches a name search and the chip shows no name', () => {
    const purged = b('p', '2026-11-21', '12:00', 'confirmed', 2, { name: null })
    expect(matchesSearch(purged, 'chan')).toBe(false)
    expect(chipName(null)).toBe('')
    expect(chipName('  Chan Tai Man ')).toBe('Chan')
  })
})

describe('bookings view state', () => {
  it('calendar by default; the URL param wins over the remembered choice; junk ignored', () => {
    expect(resolveView(null, null)).toBe('calendar')
    expect(resolveView(null, 'table')).toBe('table')
    expect(resolveView('calendar', 'table')).toBe('calendar')
    expect(resolveView('week', 'nope')).toBe('calendar')
  })

  it('table upcoming = today onward; past = the 90 days before today, newest first', () => {
    expect(tableRangeDates('upcoming', '2026-11-19')).toEqual({ from: '2026-11-19', to: '2027-11-19' })
    expect(tableRangeDates('past', '2026-11-19')).toEqual({ from: '2026-08-21', to: '2026-11-18' })
    expect(tableOrder('upcoming')).toBe('asc')
    expect(tableOrder('past')).toBe('desc')
  })

  it('needs-reply Show: Table, the all-pending range (soonest first, any date) and the Pending filter', () => {
    expect(SHOW_PENDING).toEqual({ view: 'table', tableRange: 'pending', status: 'pending' })
    expect(fetchRange('table', '2026-11-21', 'pending', '2026-11-19')).toEqual({ status: 'pending' })
    expect(tableOrder('pending')).toBe('asc')
  })

  it('calendar fetches the visible grid of the selected day', () => {
    expect(fetchRange('calendar', '2026-11-21', 'upcoming', '2026-11-19')).toEqual({ from: '2026-11-01', to: '2026-12-05' })
  })

  it('desktop prev/next moves a month (to today when it is that month); phone moves a week', () => {
    expect(stepSelected('2026-11-21', 1, false, '2026-11-19')).toBe('2026-12-01')
    expect(stepSelected('2026-12-15', -1, false, '2026-11-19')).toBe('2026-11-19')
    expect(stepSelected('2026-11-21', -1, false, '2026-11-19')).toBe('2026-10-01')
    expect(stepSelected('2026-11-28', 1, true, '2026-11-19')).toBe('2026-12-05')
  })

  it('a throwing localStorage reads as no choice and a write does not throw', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } } })
    expect(readStoredView()).toBeNull()
    expect(() => storeView('table')).not.toThrow()
  })
})

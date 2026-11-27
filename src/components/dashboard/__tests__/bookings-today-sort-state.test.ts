import { describe, it, expect } from 'vitest'
import { resolveTodaySort, todaySortSearch } from '../bookings/bookings-view-state'
import { TODAY_SORT_KEYS } from '@/domain/services/booking-today-sort'

describe('Today sort in the URL (BOOK-013 AC-25)', () => {
  it('no sort in the URL is time, earliest first', () => {
    expect(resolveTodaySort(null, null)).toEqual({ key: 'time', dir: 'asc' })
  })

  it('a key without dir starts at that key’s default (?sort=name is A–Z, guests largest first)', () => {
    expect(resolveTodaySort('name', null)).toEqual({ key: 'name', dir: 'asc' })
    expect(resolveTodaySort('guests', null)).toEqual({ key: 'guests', dir: 'desc' })
    expect(resolveTodaySort('status', null)).toEqual({ key: 'status', dir: 'asc' })
  })

  it('reads an explicit direction', () => {
    expect(resolveTodaySort('name', 'desc')).toEqual({ key: 'name', dir: 'desc' })
    expect(resolveTodaySort('guests', 'asc')).toEqual({ key: 'guests', dir: 'asc' })
  })

  it.each([
    ['phone', null],
    ['NAME', 'asc'],
    ['', 'desc'],
    ['name', 'sideways'],
    ['time', 'DESC'],
    ['<script>', 'asc'],
  ])('an invalid value (sort=%s, dir=%s) falls back to time asc', (sort, dir) => {
    expect(resolveTodaySort(sort, dir)).toEqual({ key: 'time', dir: 'asc' })
  })

  it('round-trips every key and direction through the query string', () => {
    for (const key of TODAY_SORT_KEYS) {
      for (const dir of ['asc', 'desc'] as const) {
        const search = new URLSearchParams(todaySortSearch({ key, dir }))
        expect(search.get('view')).toBe('today')
        expect(resolveTodaySort(search.get('sort'), search.get('dir'))).toEqual({ key, dir })
      }
    }
  })

  it('writes ?view=today&sort=<key>&dir=<dir>', () => {
    expect(todaySortSearch({ key: 'name', dir: 'desc' })).toBe('view=today&sort=name&dir=desc')
  })
})

// BOOK-007 (R9): guests leave out no-shows (like declined and cancelled);
// the status chips count no_show; an original with an open change request
// adds no guests when its change row is in the same list: the change row's
// party is counted then (BOOK-006 follow-up; r1 F2: otherwise the original's).
import { describe, it, expect } from 'vitest'
import { bookingsOn, covers, daySummary, filterBookings, STATUS_FILTERS, statusCounts } from '../bookings/booking-groups'
import type { BookingItem } from '@/hooks/use-bookings'

const b = (id: string, status: BookingItem['status'], extra: Partial<BookingItem> = {}): BookingItem => ({
  id, restaurantId: 'r', memberId: null, phone: '+85290000001', name: 'Test Diner', partySize: 2, bookingDate: '2026-11-19',
  bookingTime: '19:30', notes: null, status, declineReason: null, decidedBy: null, decidedAt: null, source: 'chat',
  campaignId: null, createdAt: '2026-11-01T00:00:00Z', decisionMessageStatus: null, ...extra,
})

describe('BOOK-007 guest count', () => {
  it('excludes no_show, declined and cancelled', () => {
    const list = [
      b('c', 'confirmed', { partySize: 3 }),
      b('n', 'no_show', { partySize: 5 }),
      b('d', 'declined', { partySize: 7 }),
      b('x', 'cancelled', { partySize: 11 }),
      b('p', 'pending', { partySize: 2 }),
    ]
    expect(covers(list)).toBe(5)
    expect(daySummary(list).guests).toBe(5)
  })

  it('an original + its open change count once, as the change row party', () => {
    const openChange = { id: 'chg', bookingDate: '2026-11-19', bookingTime: '20:00', partySize: 6 }
    const original = b('orig', 'confirmed', { partySize: 2, openChange })
    const change = b('chg', 'pending', { partySize: 6, replacesBookingId: 'orig' })
    expect(covers([original, change])).toBe(6)
    expect(covers([b('orig', 'pending', { partySize: 2, openChange }), change])).toBe(6)
  })

  // r1 F2: the original is skipped only when its change row is in the SAME list; otherwise nothing counts that
  // party at all (a status filter hid the pending change, or the change is on another day / month cell).
  it('the original alone (its change on another day) counts its own party on its day', () => {
    const original = b('orig', 'confirmed', { partySize: 2, openChange: { id: 'chg', bookingDate: '2026-11-25', bookingTime: '20:00', partySize: 6 } })
    expect(covers([original, b('o2', 'confirmed', { partySize: 4 })])).toBe(6)
  })

  it('a status filter that hides the pending change row leaves the original counted (table day heading)', () => {
    const openChange = { id: 'chg', bookingDate: '2026-11-19', bookingTime: '20:00', partySize: 6 }
    const all = [b('orig', 'confirmed', { partySize: 2, openChange }), b('chg', 'pending', { partySize: 6, replacesBookingId: 'orig' })]
    const confirmedOnly = filterBookings(all, 'confirmed', '')
    expect(confirmedOnly.map((x) => x.id)).toEqual(['orig'])
    expect(covers(confirmedOnly)).toBe(2)
    expect(daySummary(confirmedOnly).guests).toBe(2)
    expect(covers(all)).toBe(6)
  })

  it('another row that is not the change (different id) does not stand in for it', () => {
    const original = b('orig', 'confirmed', { partySize: 2, openChange: { id: 'chg', bookingDate: '2026-11-19', bookingTime: '20:00', partySize: 6 } })
    expect(covers([original, b('other', 'pending', { partySize: 6 })])).toBe(8)
  })

  it('the calendar month grid cell counts the original when its change moved to another day', () => {
    const openChange = { id: 'chg', bookingDate: '2026-11-25', bookingTime: '20:00', partySize: 6 }
    const month = [b('orig', 'confirmed', { partySize: 2, openChange }), b('chg', 'pending', { partySize: 6, bookingDate: '2026-11-25', replacesBookingId: 'orig' })]
    expect(covers(bookingsOn(month, '2026-11-19'))).toBe(2)
    expect(covers(bookingsOn(month, '2026-11-25'))).toBe(6)
  })

  it('no_show, declined and cancelled stay excluded whether or not an open change is in the list', () => {
    const openChange = { id: 'chg', bookingDate: '2026-11-19', bookingTime: '20:00', partySize: 6 }
    for (const status of ['no_show', 'declined', 'cancelled'] as const) {
      expect(covers([b('x', status, { partySize: 9, openChange })])).toBe(0)
      expect(covers([b('x', status, { partySize: 9 })])).toBe(0)
    }
  })

  it('a confirmed change (no longer open) is an ordinary booking', () => {
    expect(covers([b('chg', 'confirmed', { partySize: 6, replacesBookingId: 'orig' })])).toBe(6)
  })
})

describe('BOOK-007 no_show filter chip', () => {
  const list = [b('c', 'confirmed'), b('n1', 'no_show'), b('n2', 'no_show'), b('d', 'declined')]

  it('is one of the status filters and counts the no_show rows', () => {
    expect(STATUS_FILTERS).toContain('no_show')
    expect(statusCounts(list)).toMatchObject({ all: 4, confirmed: 1, no_show: 2, declined: 1 })
  })

  it('lists only no_show rows when selected', () => {
    expect(filterBookings(list, 'no_show', '').map((x) => x.id)).toEqual(['n1', 'n2'])
  })
})

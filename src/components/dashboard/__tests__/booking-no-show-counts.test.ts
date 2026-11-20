// BOOK-007 (R9): guests leave out no-shows (like declined and cancelled);
// the status chips count no_show; an original with an open change request
// adds no guests: only its change row's party is counted (BOOK-006 follow-up).
import { describe, it, expect } from 'vitest'
import { covers, daySummary, filterBookings, STATUS_FILTERS, statusCounts } from '../bookings/booking-groups'
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

  it('the original alone (its change on another day) adds no guests to its day', () => {
    const original = b('orig', 'confirmed', { partySize: 2, openChange: { id: 'chg', bookingDate: '2026-11-25', bookingTime: '20:00', partySize: 6 } })
    expect(covers([original, b('o2', 'confirmed', { partySize: 4 })])).toBe(4)
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

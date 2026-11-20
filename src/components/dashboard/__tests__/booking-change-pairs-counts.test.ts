// BOOK-006: the pending filter chip and per-day "N need a reply" count an open pair once.
import { describe, it, expect } from 'vitest'
import { daySummary, statusCounts } from '../bookings/booking-groups'
import type { BookingItem } from '@/hooks/use-bookings'

const b = (id: string, status: BookingItem['status'], extra: Partial<BookingItem> = {}): BookingItem => ({
  id, restaurantId: 'r', memberId: null, phone: '+85290000001', name: 'Test Diner', partySize: 2, bookingDate: '2026-11-26',
  bookingTime: '19:30', notes: null, status, declineReason: null, decidedBy: null, decidedAt: null, source: 'chat',
  campaignId: null, createdAt: '2026-11-01T00:00:00Z', decisionMessageStatus: null, ...extra,
})
const openChange = { id: 'chg', bookingDate: '2026-11-26', bookingTime: '18:30', partySize: 4 }
const original = b('orig', 'pending', { openChange })
const change = b('chg', 'pending', { replacesBookingId: 'orig', partySize: 4 })

describe('BOOK-006 list counts', () => {
  it('an open pair (2 pending rows) counts 1 on the pending chip and in the day heading', () => {
    expect(statusCounts([original, change])).toMatchObject({ all: 2, pending: 1 })
    expect(daySummary([original, change]).pending).toBe(1)
  })

  it('two unrelated pending rows count 2', () => {
    const list = [b('x', 'pending'), b('y', 'pending')]
    expect(statusCounts(list).pending).toBe(2)
    expect(daySummary(list).pending).toBe(2)
  })

  it('a confirmed original + its pending change count 1', () => {
    const list = [b('orig', 'confirmed', { openChange }), change]
    expect(statusCounts(list)).toMatchObject({ pending: 1, confirmed: 1 })
    expect(daySummary(list).pending).toBe(1)
  })

  it('the original alone (its change on another day) adds nothing to its day', () => {
    expect(daySummary([original]).pending).toBe(0)
  })
})

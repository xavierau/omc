// BOOK-006: an original + its open change request are one thing for staff to answer.
import { describe, it, expect } from 'vitest'
import { needsReply, pendingNeedingReply } from '../booking-request'

const slot = { id: 'chg', bookingDate: '2026-11-26', bookingTime: '18:30', partySize: 4 }

describe('BOOK-006 count rule: pending rows minus pending originals that have an open change', () => {
  it('a pending original and its pending change count once', () => {
    expect(pendingNeedingReply(2, [{ id: 'orig', replacesBookingId: null }, { id: 'chg', replacesBookingId: 'orig' }])).toBe(1)
  })

  it('two unrelated pending rows count twice', () => {
    expect(pendingNeedingReply(2, [{ id: 'a', replacesBookingId: null }, { id: 'b', replacesBookingId: null }])).toBe(2)
  })

  it('a confirmed original + its pending change: only the change is pending, so 1', () => {
    expect(pendingNeedingReply(1, [{ id: 'chg', replacesBookingId: 'confirmed-orig' }])).toBe(1)
  })

  it('pending rows past the rows read still count (the total is the exact head count)', () => {
    expect(pendingNeedingReply(1500, [{ id: 'orig', replacesBookingId: null }, { id: 'chg', replacesBookingId: 'orig' }])).toBe(1499)
  })
})

describe('BOOK-006 needsReply', () => {
  it('a pending booking with no open change needs a reply', () => {
    expect(needsReply({ status: 'pending' })).toBe(true)
    expect(needsReply({ status: 'pending', openChange: null })).toBe(true)
  })

  it('a pending original with an open change does not: its change row does', () => {
    expect(needsReply({ status: 'pending', openChange: slot })).toBe(false)
  })

  it('decided bookings never do', () => {
    expect(needsReply({ status: 'confirmed', openChange: slot })).toBe(false)
    expect(needsReply({ status: 'declined' })).toBe(false)
  })
})

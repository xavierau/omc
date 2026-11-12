// BOOK-001 W3-08 (R19): 180 days after the booking date the diner's name and
// notes are cleared and pii_purged_at is set; status, party size, dates and
// counts stay; a second run changes nothing.
import { describe, it, expect } from 'vitest'
import { purgeBookingPii } from '../booking/purge-booking-pii'
import { FakeBookingCronStore, cronBooking } from '@/test-utils/fake-booking-cron'

// 2026-11-12 10:00 HKT. Cutoff = 2026-05-16 (180 days earlier, HK date).
const NOW = new Date('2026-11-12T02:00:00.000Z')

function store() {
  return new FakeBookingCronStore([
    cronBooking({ id: 'old', bookingDate: '2026-05-15', status: 'declined' }),
    cronBooking({ id: 'edge', bookingDate: '2026-05-16' }),
    cronBooking({ id: 'new', bookingDate: '2026-11-01' }),
  ])
}

describe('purgeBookingPii (R19)', () => {
  it('clears name and notes on bookings more than 180 days past their date and stamps pii_purged_at', async () => {
    const s = store()
    expect(await purgeBookingPii({ store: s, now: () => NOW })).toEqual({ purged: 1, cutoffDate: '2026-05-16' })
    const old = s.rows.find((r) => r.id === 'old')
    expect(old).toMatchObject({ name: null, notes: null, piiPurgedAt: NOW.toISOString() })
    expect(old).toMatchObject({ status: 'declined', partySize: 4, bookingDate: '2026-05-15', bookingTime: '19:30', phone: '+85291234567' })
  })

  it('leaves newer rows untouched (including the 180-day boundary)', async () => {
    const s = store()
    await purgeBookingPii({ store: s, now: () => NOW })
    for (const id of ['edge', 'new']) {
      expect(s.rows.find((r) => r.id === id)).toMatchObject({ name: 'Chan Tai Man', notes: 'window seat', piiPurgedAt: null })
    }
  })

  it('a second run changes nothing', async () => {
    const s = store()
    await purgeBookingPii({ store: s, now: () => NOW })
    const before = JSON.stringify(s.rows)
    expect(await purgeBookingPii({ store: s, now: () => new Date(NOW.getTime() + 60_000) })).toMatchObject({ purged: 0 })
    expect(JSON.stringify(s.rows)).toBe(before)
  })
})

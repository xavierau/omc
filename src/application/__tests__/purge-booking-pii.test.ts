// BOOK-001 W3-08 (R19): 180 days after the booking date the diner's name and
// notes are cleared and pii_purged_at is set; status, party size, dates and
// counts stay; a second run changes nothing.
import { describe, it, expect } from 'vitest'
import { purgeBookingPii } from '../booking/purge-booking-pii'
import { purgeUnverifiedBookings } from '../booking/purge-unverified-bookings'
import { FakeBookingCronStore, cronBooking } from '@/test-utils/fake-booking-cron'
import { FakeAgentBookingStore } from '../booking/__tests__/fake-agent-booking'

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

// BOOK-003 (R41, review F3): the 5-minute reminders run deletes agent bookings
// still unverified an hour after they were made, and nothing else. The daily
// retention pass no longer does (it ran ~25 h late).
describe('purgeUnverifiedBookings (R41)', () => {
  async function seeded() {
    const unverified = new FakeAgentBookingStore()
    const add = async (createdAt: string, phone: string) => {
      unverified.createdAt = () => new Date(createdAt)
      await unverified.insert({
        restaurantId: 'r', phone, name: 'N', partySize: 2, bookingDate: '2026-11-20', bookingTime: '19:00', notes: null,
        confirmCode: `K7PX${phone.slice(-2)}`, verifyExpiresAt: new Date(Date.parse(createdAt) + 30 * 60_000).toISOString(),
        statusTokenHash: 'a'.repeat(64), idempotencyKey: null,
      })
    }
    await add('2026-11-12T00:59:00.000Z', '+85290000022') // 61 min old
    await add('2026-11-12T01:01:00.000Z', '+85290000033') // 59 min old
    await add('2026-11-12T00:00:00.000Z', '+85290000044') // old but verified below
    unverified.rows[2].status = 'pending'
    return unverified
  }

  it('deletes unverified rows older than one hour; keeps younger and verified ones', async () => {
    const unverified = await seeded()
    expect(await purgeUnverifiedBookings({ store: unverified, now: () => NOW })).toEqual({ unverifiedDeleted: 1 })
    expect(unverified.rows.map((r) => r.phone)).toEqual(['+85290000033', '+85290000044'])
  })
})

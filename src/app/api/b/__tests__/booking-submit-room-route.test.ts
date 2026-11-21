// BOOK-010 AC-4/AC-5/AC-8/AC-13/AC-3: the booking page submit refuses a slot
// that cannot take the party with field code `full` and up to 3 suggestions
// that fit, writes through the atomic check-and-insert, and gives the token
// back when the database refuses. Now is Fri 2026-11-20 10:00 HK.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { FakeBookingRequests, FakeBookingSender, FakeBookingSettings, FakeBookingTokens } from '@/test-utils/fake-booking'
import { FakeRateLimiter } from '@/test-utils/fake-rate-limiter'
import { FakeClock } from '@/test-utils/fake-clock'
import { FakeBookingRoom } from '@/application/booking/__tests__/fake-booking-room'
import type { SubmitBookingDeps } from '@/application/booking/submit-booking-request'
import { EMPTY_BOOKING_HOURS, type BookingHours } from '@/domain/value-objects/booking-hours'

const holder: { deps: SubmitBookingDeps | null } = { deps: null }
vi.mock('@/application/booking/booking-deps', () => ({ submitBookingDeps: () => holder.deps }))

import { POST } from '../[token]/route'

const A = 'rest-a'
const DAY = '2026-11-21'
const T1 = 'A'.repeat(43)
const T2 = 'B'.repeat(43)
const lunchDinner = [
  { label: '午市', first: '12:00', last: '14:00' },
  { label: '晚市', first: '18:00', last: '21:30' },
]
const HOURS: BookingHours = {
  ...EMPTY_BOOKING_HOURS,
  weekly: { mon: lunchDinner, tue: lunchDinner, wed: lunchDinner, thu: lunchDinner, fri: lunchDinner, sat: lunchDinner, sun: lunchDinner },
  intervalMinutes: 30,
  noticeHours: 2,
  aheadDays: 30,
  limits: { perSlot: 30, perMeal: null },
}
const BODY = { date: DAY, time: '19:00', partySize: 4, name: 'Chan Tai Man', notes: null }

let tokens: FakeBookingTokens
let requests: FakeBookingRequests
let settings: FakeBookingSettings
let room: FakeBookingRoom

function seedGuests(time: string, partySize: number, status: 'pending' | 'confirmed' | 'unverified' = 'confirmed') {
  requests.rows.push({
    id: crypto.randomUUID(), restaurantId: A, memberId: null, phone: '+85290000000', name: 'Seed', partySize, bookingDate: DAY,
    bookingTime: time, notes: null, status, declineReason: null, decidedBy: null, decidedAt: null, source: 'chat',
    campaignId: null, createdAt: '2026-11-19T00:00:00.000Z', decisionMessageStatus: null, token: null,
  })
}

beforeEach(() => {
  tokens = new FakeBookingTokens()
  tokens.add({ token: T1, restaurantId: A, phone: '+85291234567' })
  tokens.add({ token: T2, restaurantId: A, phone: '+85291234568' })
  requests = new FakeBookingRequests()
  settings = new FakeBookingSettings()
  settings.setConfig(A, { mode: 'simple', maxPartySize: 20, bookingHours: HOURS })
  room = new FakeBookingRoom(() => requests.rows, (r) => requests.insert(r))
  const clock = new FakeClock(new Date('2026-11-20T02:00:00.000Z'))
  holder.deps = {
    tokens, requests, settings, members: { findMemberId: vi.fn().mockResolvedValue(null) }, sender: new FakeBookingSender(),
    limiter: new FakeRateLimiter(clock), now: () => clock.now(), room,
  }
})

function post(body: unknown, token = T1) {
  const req = new NextRequest(`https://app.ohmyclient.io/api/b/${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-real-ip': '203.0.113.9' },
    body: JSON.stringify(body),
  })
  return POST(req, { params: Promise.resolve({ token }) })
}

const created = () => requests.rows.filter((r) => r.name === 'Chan Tai Man')

describe('POST /api/b/[token] with guest limits and stops (BOOK-010)', () => {
  it('a party that fits is stored through the atomic check-and-insert', async () => {
    seedGuests('19:00', 26)
    expect((await post(BODY)).status).toBe(200)
    expect(created()).toHaveLength(1)
    expect(room.calls.some((c) => c.startsWith('insertIfRoom'))).toBe(true)
  })

  it('AC-4: 28 of 30 taken, party of 4 → 400 time full + up to 3 suggestions that fit; nothing stored; link still usable', async () => {
    seedGuests('19:00', 28)
    seedGuests('18:30', 27)
    const res = await post(BODY)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body).toMatchObject({ error: 'invalid', fields: { time: 'full' } })
    expect(body.suggestedTimes).toEqual([
      { date: DAY, time: '19:30' },
      { date: DAY, time: '18:00' },
      { date: DAY, time: '20:00' },
    ])
    expect(created()).toHaveLength(0)
    expect((await post({ ...BODY, time: '19:30' })).status).toBe(200)
  })

  it('counting: unverified agent bookings and declined rows never count', async () => {
    seedGuests('19:00', 28, 'unverified')
    seedGuests('19:00', 20)
    requests.rows[1].status = 'declined'
    expect((await post(BODY)).status).toBe(200)
  })

  it('AC-5: two submits for the last 4 seats at once → exactly one booking, the other full', async () => {
    seedGuests('19:00', 26)
    const [a, b] = await Promise.all([post(BODY, T1), post({ ...BODY, name: 'Chan Tai Man' }, T2)])
    expect([a.status, b.status].sort()).toEqual([200, 400])
    expect(created()).toHaveLength(1)
  })

  it('AC-5/AC-13: the database refuses after the early check passed → 400 full, token given back', async () => {
    seedGuests('19:00', 26)
    holder.deps = { ...(holder.deps as SubmitBookingDeps), room: staleReads(room) }
    seedGuests('19:00', 4)
    const res = await post(BODY)
    expect(res.status).toBe(400)
    expect((await res.json()).fields).toEqual({ time: 'full' })
    expect(tokens.rows.find((t) => t.token === T1)?.consumedAt).toBeNull()
  })

  it('AC-8: 晚市 stopped → dinner refused full, lunch still books', async () => {
    room.seedStop(A, { date: DAY, scope: 'period', periodLabel: '晚市' })
    const res = await post(BODY)
    expect(res.status).toBe(400)
    expect((await res.json()).fields).toEqual({ time: 'full' })
    expect((await post({ ...BODY, time: '12:30' })).status).toBe(200)
  })

  it('AC-3: no limits and no stops → BOOK-009 behaviour (no full code, body unchanged)', async () => {
    settings.setConfig(A, { mode: 'simple', maxPartySize: 20, bookingHours: { ...HOURS, limits: undefined } })
    seedGuests('19:00', 500)
    const res = await post(BODY)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, delivered: expect.any(Boolean) })
  })

  it('AC-3: hours not set → no room read at all', async () => {
    settings.setConfig(A, { mode: 'simple', maxPartySize: 20 })
    expect((await post(BODY)).status).toBe(200)
    expect(room.calls).toEqual([])
  })
})

/** A room store whose reads miss the newest row (the race the database closes). */
function staleReads(inner: FakeBookingRoom) {
  return {
    readRoom: async () => ({ counts: {}, stops: [] }),
    insertIfRoom: inner.insertIfRoom.bind(inner),
  }
}

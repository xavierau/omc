// BOOK-010 I-010: the booking page submit follows BOOK-009's schedule switch.
// Off → no limits and no stops are checked (BOOK-001 any time), although
// both stay stored. Now is Fri 2026-11-20 10:00 HK; 2026-11-21 is a Saturday.
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
const lunchDinner = [
  { label: '午市', first: '12:00', last: '14:00' },
  { label: '晚市', first: '18:00', last: '21:30' },
]
const HOURS: BookingHours = {
  ...EMPTY_BOOKING_HOURS,
  weekly: { mon: lunchDinner, tue: lunchDinner, wed: lunchDinner, thu: lunchDinner, fri: lunchDinner, sat: lunchDinner, sun: lunchDinner },
  limits: { perSlot: 30, perMeal: 60 },
}
const BODY = { date: DAY, time: '19:00', partySize: 4, name: 'Chan Tai Man', notes: null }

let requests: FakeBookingRequests
let settings: FakeBookingSettings
let room: FakeBookingRoom

function seedGuests(time: string, partySize: number) {
  requests.rows.push({
    id: crypto.randomUUID(), restaurantId: A, memberId: null, phone: '+85290000000', name: 'Seed', partySize, bookingDate: DAY,
    bookingTime: time, notes: null, status: 'confirmed', declineReason: null, decidedBy: null, decidedAt: null, source: 'chat',
    campaignId: null, createdAt: '2026-11-19T00:00:00.000Z', decisionMessageStatus: null, token: null,
  })
}

beforeEach(() => {
  const tokens = new FakeBookingTokens()
  tokens.add({ token: T1, restaurantId: A, phone: '+85291234567' })
  requests = new FakeBookingRequests()
  settings = new FakeBookingSettings()
  room = new FakeBookingRoom(() => requests.rows, (r) => requests.insert(r))
  const clock = new FakeClock(new Date('2026-11-20T02:00:00.000Z'))
  holder.deps = {
    tokens, requests, settings, members: { findMemberId: vi.fn().mockResolvedValue(null) }, sender: new FakeBookingSender(),
    limiter: new FakeRateLimiter(clock), now: () => clock.now(), room,
  }
})

function post(body: unknown) {
  const req = new NextRequest(`https://app.ohmyclient.io/api/b/${T1}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-real-ip': '203.0.113.9' },
    body: JSON.stringify(body),
  })
  return POST(req, { params: Promise.resolve({ token: T1 }) })
}

describe('POST /api/b/[token] with the schedule switch off', () => {
  it('a full slot and a stopped day are not checked: the booking is stored, without the room check', async () => {
    settings.setConfig(A, { mode: 'simple', maxPartySize: 20, bookingHours: { ...HOURS, scheduleEnabled: false } })
    seedGuests('19:00', 30)
    room.seedStop(A, { date: DAY, scope: 'day' })
    expect((await post(BODY)).status).toBe(200)
    expect(requests.rows.filter((r) => r.name === 'Chan Tai Man')).toHaveLength(1)
    expect(room.calls.some((c) => c.startsWith('insertIfRoom'))).toBe(false)
  })

  it('switched on, the same full slot is refused with full', async () => {
    settings.setConfig(A, { mode: 'simple', maxPartySize: 20, bookingHours: HOURS })
    seedGuests('19:00', 30)
    const res = await post(BODY)
    expect(res.status).toBe(400)
    expect((await res.json()).fields).toEqual({ time: 'full' })
  })
})

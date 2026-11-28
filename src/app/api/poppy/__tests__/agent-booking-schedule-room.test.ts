// BOOK-010 I-010: personal agents (PAP) and the booking page follow BOOK-009's
// schedule switch: off → no limits and no stops (any time, as BOOK-001); and
// the WhatsApp code step runs BOOK-009's rules re-check first, then BOOK-010's
// room check, with exactly one reply per booking.
// Clock: 2026-11-20T02:00Z = Fri 20 Nov 10:00 in Hong Kong; 21 Nov is a Saturday.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { FakeBookingSender, FakeBookingSettings } from '@/test-utils/fake-booking'
import { FakeRateLimiter } from '@/test-utils/fake-rate-limiter'
import { FakeClock } from '@/test-utils/fake-clock'
import { FakeAgentBookingStore, FakeAgentDirectory, scriptedSecrets } from '@/application/booking/__tests__/fake-agent-booking'
import { FakeBookingRoom } from '@/application/booking/__tests__/fake-booking-room'
import type { CreateAgentBookingDeps } from '@/application/booking/create-agent-booking'
import type { GetAgentAvailabilityDeps } from '@/application/booking/get-agent-availability'
import { verifyAgentBooking, type VerifyAgentBookingDeps } from '@/application/booking/verify-agent-booking'
import { EMPTY_BOOKING_HOURS, type BookingHours } from '@/domain/value-objects/booking-hours'
import type { BookingConfig } from '@/domain/value-objects/booking-config'

const holder: { create: CreateAgentBookingDeps | null; availability: GetAgentAvailabilityDeps | null } = { create: null, availability: null }
vi.mock('@/application/booking/booking-deps', () => ({
  createAgentBookingDeps: () => holder.create,
  getAgentAvailabilityDeps: () => holder.availability,
}))

import { POST } from '../[publicId]/bookings/route'
import { GET as GET_AVAILABILITY } from '../[publicId]/availability/route'

const A = 'rest-a'
const PID = 'A'.repeat(32)
const PHONE = '+85291234567'
const DAY = '2026-11-21'
const PRIVACY = 'https://ohmyclient.io/privacy-policy.html'
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
const OFF: BookingHours = { ...HOURS, scheduleEnabled: false }

let store: FakeAgentBookingStore
let directory: FakeAgentDirectory
let settings: FakeBookingSettings
let clock: FakeClock
let room: FakeBookingRoom

function tenant(patch: Partial<BookingConfig> = {}) {
  directory.tenants.clear()
  settings.configs.set(A, directory.add(A, PID, { maxPartySize: 8, bookingHours: HOURS, ...patch }))
}

function seedGuests(time: string, partySize: number) {
  store.seedPending(A, '+85290000000', 'chat')
  Object.assign(store.rows[store.rows.length - 1], { bookingDate: DAY, bookingTime: time, partySize, status: 'confirmed' })
}

beforeEach(() => {
  clock = new FakeClock(new Date('2026-11-20T02:00:00.000Z'))
  store = new FakeAgentBookingStore()
  store.createdAt = () => clock.now()
  directory = new FakeAgentDirectory()
  settings = new FakeBookingSettings()
  settings.restaurants.set(A, { name: 'Cafe A', logoUrl: null, whatsappNumber: '+85230001111' })
  room = new FakeBookingRoom(() => store.rows)
  store.roomRefusal = (restaurantId, slot, check) => room.refusal(restaurantId, slot, check)
  tenant()
  const limiter = new FakeRateLimiter(clock)
  holder.create = {
    directory, store, settings, limiter, secrets: scriptedSecrets(['K7PX3M', 'Q2W3E4', 'Z9Y8X7']),
    privacyUrl: PRIVACY, now: () => clock.now(), room,
  }
  holder.availability = { directory, limiter, now: () => clock.now(), room }
})

function post(body: Record<string, unknown> = {}) {
  const req = new NextRequest(`https://app.ohmyclient.io/api/poppy/${PID}/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-real-ip': '203.0.113.9' },
    body: JSON.stringify({ date: DAY, time: '19:00', party_size: 4, name: 'Chan', phone: PHONE, ...body }),
  })
  return POST(req, { params: Promise.resolve({ publicId: PID }) })
}

async function availability(query: string) {
  const req = new NextRequest(`https://app.ohmyclient.io/api/poppy/${PID}/availability?${query}`, { headers: { 'x-real-ip': '203.0.113.9' } })
  return (await GET_AVAILABILITY(req, { params: Promise.resolve({ publicId: PID }) })).json()
}

function verifyDeps(texts: string[], sender: FakeBookingSender): VerifyAgentBookingDeps {
  return {
    store, members: { findMemberId: async () => null }, settings, sender,
    sendText: async (_r, _p, text) => void texts.push(text), privacyUrl: PRIVACY, now: () => clock.now(),
    bookingLink: async () => 'https://app.ohmyclient.io/b/LINK',
    room: { reader: room, bookingLink: async () => 'https://app.ohmyclient.io/b/LINK' },
  }
}

describe('schedule switch off: no limits, no stops (PAP)', () => {
  it('POST a slot over its stored limit, or under a stored stop → accepted (202)', async () => {
    tenant({ bookingHours: OFF })
    seedGuests('19:00', 30)
    room.seedStop(A, { date: DAY, scope: 'day' })
    expect((await post()).status).toBe(202)
  })

  it('GET /availability → every date open at any time (times null), whatever the counts and stops', async () => {
    tenant({ bookingHours: OFF })
    seedGuests('19:00', 30)
    room.seedStop(A, { date: DAY, scope: 'day' })
    const body = await availability(`from=${DAY}&days=1&party_size=4`)
    expect(body.dates).toEqual([{ date: DAY, open: true, times: null }])
  })

  it('the code arrives after the slot filled, schedule switched off meanwhile → promoted (no room check)', async () => {
    const code = (await (await post()).json()).confirm_code as string
    seedGuests('19:00', 30)
    tenant({ bookingHours: OFF })
    const texts: string[] = []
    const sender = new FakeBookingSender()
    await verifyAgentBooking(verifyDeps(texts, sender), { restaurantId: A, phone: PHONE, text: code, wamid: 'wamid.off' })
    expect(store.rows.find((r) => r.phone === PHONE)?.status).toBe('pending')
    expect(sender.sent).toHaveLength(1)
  })
})

describe('code step: rules first, then room, one reply', () => {
  it('a booking that now breaks the rules AND whose slot filled → declined "rules", one reply (the rules one), no full reply', async () => {
    const code = (await (await post()).json()).confirm_code as string
    seedGuests('19:00', 30)
    tenant({ bookingHours: { ...HOURS, weekly: { ...HOURS.weekly, sat: [] } } })
    const texts: string[] = []
    const sender = new FakeBookingSender()
    const result = await verifyAgentBooking(verifyDeps(texts, sender), { restaurantId: A, phone: PHONE, text: code, wamid: 'wamid.r' })
    expect(result).toEqual({ handled: true })
    expect(store.rows.find((r) => r.phone === PHONE)).toMatchObject({ status: 'declined', declineReason: 'rules' })
    expect(texts).toHaveLength(1)
    expect(texts[0]).toContain('can no longer be booked')
    expect(texts[0]).not.toContain('just filled up')
    expect(sender.sent).toHaveLength(0)
  })

  it('a booking that passes the rules but whose slot filled → declined "full", one reply (the full one)', async () => {
    seedGuests('19:00', 24)
    const code = (await (await post()).json()).confirm_code as string
    seedGuests('19:00', 4)
    const texts: string[] = []
    const sender = new FakeBookingSender()
    await verifyAgentBooking(verifyDeps(texts, sender), { restaurantId: A, phone: PHONE, text: code, wamid: 'wamid.f' })
    expect(store.rows.find((r) => r.phone === PHONE)).toMatchObject({ status: 'declined', declineReason: 'full' })
    expect(texts).toHaveLength(1)
    expect(texts[0]).toContain('just filled up')
    expect(store.calls.indexOf('findPromotable')).toBeLessThan(store.calls.indexOf('promote'))
  })
})

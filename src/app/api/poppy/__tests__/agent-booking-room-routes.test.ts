// BOOK-010: personal agents (PAP) see full times as full (spec AC-4, AC-6,
// AC-9, AC-14), through the real routes and use cases with in-memory ports.
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

const holder: { create: CreateAgentBookingDeps | null; availability: GetAgentAvailabilityDeps | null; openapi: unknown } = {
  create: null,
  availability: null,
  openapi: null,
}
vi.mock('@/application/booking/booking-deps', () => ({
  createAgentBookingDeps: () => holder.create,
  getAgentAvailabilityDeps: () => holder.availability,
  agentOpenApiDeps: () => holder.openapi,
}))

import { POST } from '../[publicId]/bookings/route'
import { GET as GET_AVAILABILITY } from '../[publicId]/availability/route'
import { GET as GET_OPENAPI } from '../[publicId]/openapi.json/route'

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

let store: FakeAgentBookingStore
let directory: FakeAgentDirectory
let settings: FakeBookingSettings
let clock: FakeClock
let room: FakeBookingRoom

function tenant(patch: Partial<BookingConfig> = {}) {
  directory.tenants.clear()
  settings.configs.set(A, directory.add(A, PID, { maxPartySize: 8, bookingHours: HOURS, ...patch }))
}

/** A booking already holding seats (any source), straight into the table. */
function seedGuests(time: string, partySize: number, status: 'pending' | 'confirmed' = 'confirmed', date = DAY) {
  store.seedPending(A, '+85290000000', 'chat')
  Object.assign(store.rows[store.rows.length - 1], { bookingDate: date, bookingTime: time, partySize, status })
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
  holder.openapi = { directory, settings, appUrl: 'https://app.ohmyclient.io', privacyUrl: PRIVACY, now: () => clock.now() }
})

function post(body: Record<string, unknown>) {
  const req = new NextRequest(`https://app.ohmyclient.io/api/poppy/${PID}/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-real-ip': '203.0.113.9' },
    body: JSON.stringify({ date: DAY, time: '19:00', party_size: 4, name: 'Chan', phone: PHONE, ...body }),
  })
  return POST(req, { params: Promise.resolve({ publicId: PID }) })
}

async function availability(query: string) {
  const req = new NextRequest(`https://app.ohmyclient.io/api/poppy/${PID}/availability?${query}`, { headers: { 'x-real-ip': '203.0.113.9' } })
  const res = await GET_AVAILABILITY(req, { params: Promise.resolve({ publicId: PID }) })
  return { status: res.status, body: await res.json() }
}

type DateRow = { date: string; open: boolean; times: string[] | null }
const dateOf = (body: { dates: DateRow[] }, date: string) => body.dates.find((d) => d.date === date) as DateRow

describe('AC-4 POST /bookings refuses a full slot', () => {
  it('AC-4: 28 of 30 at 19:00, party of 4 → 400 fields.time full + suggested_times that fit; nothing written', async () => {
    seedGuests('19:00', 28)
    seedGuests('18:30', 28)
    const res = await post({})
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body).toMatchObject({ error: 'invalid_request', fields: { time: 'full' } })
    expect(body.suggested_times).toEqual([
      { date: DAY, time: '19:30' },
      { date: DAY, time: '18:00' },
      { date: DAY, time: '20:00' },
    ])
    expect(store.calls).not.toContain('insert')
  })

  it('AC-8: a stopped period → full; a party that fits elsewhere books', async () => {
    room.seedStop(A, { date: DAY, scope: 'period', periodLabel: '晚市' })
    expect((await (await post({})).json()).fields).toEqual({ time: 'full' })
    expect((await post({ time: '12:30' })).status).toBe(202)
  })

  it('AC-3: no limits, no stops → unchanged (201)', async () => {
    tenant({ bookingHours: { ...HOURS, limits: undefined } })
    seedGuests('19:00', 500)
    expect((await post({})).status).toBe(202)
  })
})

describe('AC-14 GET /availability fits the party size and the stops', () => {
  it('AC-14: a time that cannot take party_size is left out; party_size defaults to 1', async () => {
    seedGuests('19:00', 28)
    const for4 = await availability(`from=${DAY}&days=2&party_size=4`)
    expect(for4.status).toBe(200)
    expect(dateOf(for4.body, DAY).times).not.toContain('19:00')
    expect(dateOf(for4.body, DAY).times).toContain('19:30')
    expect(dateOf((await availability(`from=${DAY}&days=2&party_size=2`)).body, DAY).times).toContain('19:00')
    seedGuests('19:00', 2)
    expect(dateOf((await availability(`from=${DAY}&days=2`)).body, DAY).times).not.toContain('19:00')
  })

  it('AC-9: a stopped day is open: false with no times; the next day stays open', async () => {
    room.seedStop(A, { date: DAY, scope: 'day' })
    const { body } = await availability(`from=${DAY}&days=2`)
    expect(dateOf(body, DAY)).toEqual({ date: DAY, open: false, times: [] })
    expect(dateOf(body, '2026-11-22').open).toBe(true)
  })

  it('AC-14: every slot full → open: false', async () => {
    tenant({ bookingHours: { ...HOURS, limits: { perSlot: null, perMeal: 10 } } })
    seedGuests('12:00', 10)
    seedGuests('18:00', 10)
    expect(dateOf((await availability(`from=${DAY}&days=1`)).body, DAY)).toEqual({ date: DAY, open: false, times: [] })
  })

  it('AC-3: hours set, no limits or stops → every grid time, as BOOK-009', async () => {
    tenant({ bookingHours: { ...HOURS, limits: undefined } })
    seedGuests('19:00', 500)
    expect(dateOf((await availability(`from=${DAY}&days=1&party_size=8`)).body, DAY).times).toContain('19:00')
  })
})

describe('AC-14 OpenAPI explains full', () => {
  it('the rules text names the full code and that times may fill up', async () => {
    const req = new NextRequest(`https://app.ohmyclient.io/api/poppy/${PID}/openapi.json`)
    const doc = await (await GET_OPENAPI(req, { params: Promise.resolve({ publicId: PID }) })).json()
    expect(doc.info.description).toContain('full')
    expect(doc.info.description).toMatch(/party_size/)
  })
})

describe('AC-6 the WhatsApp code arrives after the slot filled', () => {
  async function createThenFill() {
    seedGuests('19:00', 24)
    const created = await post({})
    expect(created.status).toBe(202)
    const code = (await created.json()).confirm_code as string
    seedGuests('19:00', 4) // the slot filled while the diner was away: 28 + 4 > 30
    return code
  }

  function verifyDeps(texts: string[], sender: FakeBookingSender): VerifyAgentBookingDeps {
    return {
      store, members: { findMemberId: async () => null }, settings, sender,
      sendText: async (_r, _p, text) => void texts.push(text), privacyUrl: PRIVACY, now: () => clock.now(),
      room: { reader: room, bookingLink: async () => 'https://app.ohmyclient.io/b/LINK' },
    }
  }

  it('AC-6: the booking becomes declined "full" (no staff action) and the diner gets the full reply with suggestions + link', async () => {
    const code = await createThenFill()
    const texts: string[] = []
    const sender = new FakeBookingSender()
    const result = await verifyAgentBooking(verifyDeps(texts, sender), { restaurantId: A, phone: PHONE, text: code, wamid: 'wamid.1' })
    expect(result).toEqual({ handled: true })
    const row = store.rows.find((r) => r.phone === PHONE)
    expect(row).toMatchObject({ status: 'declined', declineReason: 'full' })
    expect(sender.sent).toHaveLength(0)
    expect(texts).toHaveLength(1)
    expect(texts[0]).toContain('滿')
    expect(texts[0]).toContain('19:30')
    expect(texts[0]).toContain('https://app.ohmyclient.io/b/LINK')
  })

  it('a code for a booking that still fits is promoted as before', async () => {
    seedGuests('19:00', 20)
    const code = (await (await post({})).json()).confirm_code as string
    const texts: string[] = []
    const sender = new FakeBookingSender()
    await verifyAgentBooking(verifyDeps(texts, sender), { restaurantId: A, phone: PHONE, text: code, wamid: 'wamid.2' })
    expect(store.rows.find((r) => r.phone === PHONE)?.status).toBe('pending')
    expect(sender.sent).toHaveLength(1)
  })
})

// BOOK-010 F1 (review P2-1): a slot the booking HOURS refuse gets alternatives
// that also fit the party (limits, stops), on POST /bookings and at the code step.
describe('F1 P2-1 rules-refusal suggestions skip full and stopped times', () => {
  const closedDay = { ...HOURS, special: [{ date: DAY, periods: [] }] }
  const NEXT = '2026-11-22'

  it('POST on a closed day: suggested_times never hold a full or stopped time', async () => {
    tenant({ bookingHours: closedDay })
    seedGuests('19:00', 30, 'confirmed', NEXT)
    room.seedStop(A, { date: NEXT, scope: 'slot', time: '18:30' })
    const res = await post({})
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.fields).toEqual({ date: 'closed_day' })
    expect(body.suggested_times).toHaveLength(3)
    expect(body.suggested_times).not.toContainEqual({ date: NEXT, time: '19:00' })
    expect(body.suggested_times).not.toContainEqual({ date: NEXT, time: '18:30' })
    expect(body.suggested_times).toContainEqual({ date: NEXT, time: '19:30' })
  })

  it('too_far: the window-end suggestions skip a full time there', async () => {
    const last = '2026-12-20' // today + 30
    seedGuests('19:00', 30, 'confirmed', last)
    const res = await post({ date: '2027-01-05' })
    const body = await res.json()
    expect(body.fields).toEqual({ time: 'too_far' })
    expect(body.suggested_times.length).toBeGreaterThan(0)
    expect(body.suggested_times).not.toContainEqual({ date: last, time: '19:00' })
  })

  it('code step: the day closed after the POST → the reply never offers a full time', async () => {
    const code = (await (await post({})).json()).confirm_code as string
    tenant({ bookingHours: closedDay })
    seedGuests('19:00', 30, 'confirmed', NEXT)
    const texts: string[] = []
    const deps: VerifyAgentBookingDeps = {
      store, members: { findMemberId: async () => null }, settings, sender: new FakeBookingSender(),
      sendText: async (_r, _p, text) => void texts.push(text), privacyUrl: PRIVACY, now: () => clock.now(),
      room: { reader: room, bookingLink: async () => null },
    }
    await verifyAgentBooking(deps, { restaurantId: A, phone: PHONE, text: code, wamid: 'wamid.f1' })
    expect(store.rows.find((r) => r.phone === PHONE)).toMatchObject({ status: 'declined', declineReason: 'rules' })
    expect(texts).toHaveLength(1)
    expect(texts[0]).toContain(`${NEXT} 19:30`)
    expect(texts[0]).not.toContain(`${NEXT} 19:00`)
  })
})

// BOOK-010 F1 (review P3-1, plan budget): a `full` answer reads the window once.
describe('F1 P3-1 one room read per refusal', () => {
  it('a full slot on POST → readRoom called once', async () => {
    seedGuests('19:00', 30)
    expect((await (await post({})).json()).fields).toEqual({ time: 'full' })
    expect(room.calls.filter((c) => c.startsWith('readRoom'))).toHaveLength(1)
  })
})

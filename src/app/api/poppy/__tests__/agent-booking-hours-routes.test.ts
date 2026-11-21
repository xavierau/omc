// BOOK-009 W4: the personal-agent API follows the restaurant's booking hours
// and terms (spec AC-11..AC-14, threat R2), through the real routes with
// in-memory ports. Clock: 2026-11-19T02:00Z = Thu 19 Nov 10:00 in Hong Kong.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { FakeBookingSettings } from '@/test-utils/fake-booking'
import { FakeRateLimiter } from '@/test-utils/fake-rate-limiter'
import { FakeClock } from '@/test-utils/fake-clock'
import { FakeAgentBookingStore, FakeAgentDirectory, scriptedSecrets } from '@/application/booking/__tests__/fake-agent-booking'
import type { CreateAgentBookingDeps } from '@/application/booking/create-agent-booking'
import type { GetAgentAvailabilityDeps } from '@/application/booking/get-agent-availability'
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
const PRIVACY = 'https://ohmyclient.io/privacy-policy.html'
const lunchDinner = [
  { label: '午市', first: '12:00', last: '14:00' },
  { label: '晚市', first: '18:00', last: '21:30' },
]
const HOURS: BookingHours = {
  ...EMPTY_BOOKING_HOURS,
  weekly: { mon: [], tue: lunchDinner, wed: lunchDinner, thu: lunchDinner, fri: lunchDinner, sat: lunchDinner, sun: lunchDinner },
  intervalMinutes: 30,
  noticeHours: 2,
  aheadDays: 30,
  special: [{ date: '2026-11-25', label: '休息', periods: [] }],
  tableMinutes: 120,
}
const TERMS = { zh_hk: '訂座保留 15 分鐘。', en: 'Tables are held for 15 minutes.' }
const GRID = ['12:00', '12:30', '13:00', '13:30', '14:00', '18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00', '21:30']

let store: FakeAgentBookingStore
let directory: FakeAgentDirectory
let settings: FakeBookingSettings
let clock: FakeClock
let limiter: FakeRateLimiter

function tenant(patch: Partial<BookingConfig> = {}, agent: Partial<BookingConfig['agentBooking']> = {}) {
  directory.tenants.clear()
  directory.add(A, PID, { maxPartySize: 8, ...patch }, agent)
}

beforeEach(() => {
  clock = new FakeClock(new Date('2026-11-19T02:00:00.000Z'))
  store = new FakeAgentBookingStore()
  store.createdAt = () => clock.now()
  directory = new FakeAgentDirectory()
  settings = new FakeBookingSettings()
  settings.restaurants.set(A, { name: 'Cafe A', logoUrl: null, whatsappNumber: '+85230001111' })
  limiter = new FakeRateLimiter(clock)
  tenant({ bookingHours: HOURS })
  holder.create = {
    directory, store, settings, limiter, secrets: scriptedSecrets(['K7PX3M', 'Q2W3E4', 'Z9Y8X7']),
    privacyUrl: PRIVACY, now: () => clock.now(),
  }
  holder.availability = { directory, limiter, now: () => clock.now() }
  holder.openapi = { directory, settings, appUrl: 'https://app.ohmyclient.io', privacyUrl: PRIVACY, now: () => clock.now() }
})
afterEach(() => vi.restoreAllMocks())

function availability(query: string, opts: { pid?: string; ip?: string } = {}) {
  const pid = opts.pid ?? PID
  const req = new NextRequest(`https://app.ohmyclient.io/api/poppy/${pid}/availability?${query}`, {
    headers: { 'x-real-ip': opts.ip ?? '203.0.113.9' },
  })
  return GET_AVAILABILITY(req, { params: Promise.resolve({ publicId: pid }) })
}

function post(body: unknown, ip = '203.0.113.9') {
  const req = new NextRequest(`https://app.ohmyclient.io/api/poppy/${PID}/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-real-ip': ip },
    body: JSON.stringify(body),
  })
  return POST(req, { params: Promise.resolve({ publicId: PID }) })
}

const booking = (patch: Record<string, unknown> = {}) => ({ date: '2026-11-20', time: '19:00', party_size: 4, name: 'Chan', phone: PHONE, ...patch })

type DateRow = { date: string; open: boolean; times: string[] | null }

describe('AC-11 GET /availability with booking hours', () => {
  it('AC-11 per date: closed weekday and special date are not open; times on the grid; minimum notice applies today', async () => {
    const res = await availability('from=2026-11-19&days=7')
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toContain('no-store')
    const body = await res.json()
    expect(body).toMatchObject({ interval_minutes: 30, table_minutes: 120, max_party_size: 8, terms: null })
    const dates = body.dates as DateRow[]
    expect(dates.map((d) => d.date)).toEqual(['2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25'])
    const byDate = Object.fromEntries(dates.map((d) => [d.date, d]))
    expect(byDate['2026-11-23']).toEqual({ date: '2026-11-23', open: false, times: [] })
    expect(byDate['2026-11-25']).toEqual({ date: '2026-11-25', open: false, times: [] })
    expect(byDate['2026-11-20']).toEqual({ date: '2026-11-20', open: true, times: GRID })
    // Now 10:00 with 2 h notice: 12:00 is exactly on the boundary and still bookable.
    expect(byDate['2026-11-19']).toEqual({ date: '2026-11-19', open: true, times: GRID })
    for (const d of dates) for (const t of d.times ?? []) expect(GRID).toContain(t)
  })

  it('AC-11 a day whose every slot is inside the minimum notice is not open', async () => {
    clock.set(new Date('2026-11-19T13:00:00.000Z')) // 21:00 HK: 21:30 is inside 2 h
    const body = await (await availability('from=2026-11-19&days=2')).json()
    expect(body.dates[0]).toEqual({ date: '2026-11-19', open: false, times: [] })
    expect(body.dates[1].open).toBe(true)
  })

  it('AC-11 dates past the window are not open', async () => {
    tenant({ bookingHours: { ...HOURS, aheadDays: 7 } })
    const body = await (await availability('from=2026-11-25&days=7')).json()
    const byDate = Object.fromEntries((body.dates as DateRow[]).map((d) => [d.date, d]))
    expect(byDate['2026-11-26'].open).toBe(true)
    expect(byDate['2026-11-27']).toEqual({ date: '2026-11-27', open: false, times: [] })
  })

  it('AC-11 party_size within the limit is accepted', async () => {
    const res = await availability('from=2026-11-20&days=1&party_size=4')
    expect(res.status).toBe(200)
    expect((await res.json()).dates[0].times).toEqual(GRID)
  })

  it('AC-11 terms are returned in both languages when set', async () => {
    tenant({ bookingHours: { ...HOURS, terms: TERMS } })
    const body = await (await availability('from=2026-11-20&days=1')).json()
    expect(body.terms).toEqual({ 'zh-HK': TERMS.zh_hk, en: TERMS.en })
  })

  it.each([
    ['from missing', 'days=3', 'from'],
    ['from not a date', 'from=2026-02-30&days=3', 'from'],
    ['from in the past', 'from=2026-11-18&days=3', 'from'],
    ['days missing', 'from=2026-11-20', 'days'],
    ['days 0', 'from=2026-11-20&days=0', 'days'],
    // F1 (P3-4): the 30-day window is 31 dates (today … today + 30), so 31 is the cap.
    ['days above the 31-date window', 'from=2026-11-20&days=32', 'days'],
    ['days not a number', 'from=2026-11-20&days=x', 'days'],
    ['party_size above the max', 'from=2026-11-20&days=3&party_size=9', 'party_size'],
    ['party_size 0', 'from=2026-11-20&days=3&party_size=0', 'party_size'],
  ])('R2 %s → 400 invalid_request', async (_label, query, field) => {
    const res = await availability(query)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_request')
    expect(body.fields[field]).toBeDefined()
  })

  it('R2 days cap is 31 even when the window is longer', async () => {
    tenant({ bookingHours: { ...HOURS, aheadDays: 90 } })
    expect((await availability('from=2026-11-20&days=31')).status).toBe(200)
    expect((await availability('from=2026-11-20&days=32')).status).toBe(400)
  })

  it('R2 unknown publicId, agent booking off → 404 like POST /bookings', async () => {
    expect((await availability('from=2026-11-20&days=3', { pid: 'C'.repeat(32) })).status).toBe(404)
    tenant({ bookingHours: HOURS }, { enabled: false })
    expect((await availability('from=2026-11-20&days=3')).status).toBe(404)
  })

  // BOOK-010-RL (owner default 2026-11-21): availability has its own per-IP bucket
  // of 30/min, apart from POST /bookings' 10/min, so browsing times never locks out booking.
  it('R2 own per-IP limit: the 31st availability call in a minute → 429 with Retry-After; the 30th → 200', async () => {
    for (let i = 0; i < 29; i++) expect((await availability('from=2026-11-20&days=1')).status).toBe(200)
    expect((await availability('from=2026-11-20&days=1')).status).toBe(200)
    const res = await availability('from=2026-11-20&days=1')
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('60')
    expect((await res.json()).error).toBe('rate_limited')
    expect((await availability('from=2026-11-20&days=1', { ip: '198.51.100.7' })).status).toBe(200)
  })

  it('R2 30 availability calls leave POST /bookings its full 10 per minute', async () => {
    for (let i = 0; i < 30; i++) expect((await availability('from=2026-11-20&days=1')).status).toBe(200)
    // An empty body passes the IP limit and stops at validation (400), so no other cap is touched.
    for (let i = 0; i < 10; i++) expect((await post({})).status).toBe(400)
    expect((await post({})).status).toBe(429)
  })

  it('R2 10 POST /bookings calls leave availability its full 30 per minute', async () => {
    for (let i = 0; i < 10; i++) expect((await post({})).status).toBe(400)
    expect((await post({})).status).toBe(429)
    for (let i = 0; i < 30; i++) expect((await availability('from=2026-11-20&days=1')).status).toBe(200)
    expect((await availability('from=2026-11-20&days=1')).status).toBe(429)
  })
})

describe('AC-14 GET /availability without booking hours', () => {
  beforeEach(() => tenant({ bookingHours: null }))

  it('AC-14 every date open, times null (any time); interval, table time and terms null', async () => {
    const body = await (await availability('from=2026-11-19&days=31')).json()
    expect(body).toMatchObject({ interval_minutes: null, table_minutes: null, max_party_size: 8, terms: null })
    expect(body.dates).toHaveLength(31)
    for (const d of body.dates as DateRow[]) expect(d).toMatchObject({ open: true, times: null })
    expect(body.dates[30].date).toBe('2026-12-19')
  })

  it('AC-14 days 32 → 400', async () => {
    expect((await availability('from=2026-11-19&days=32')).status).toBe(400)
  })
})

describe('AC-12 POST /bookings outside the rules → field code + suggested_times, nothing stored', () => {
  it.each([
    ['outside_hours', {}, booking({ time: '15:00' }), { time: 'outside_hours' },
      [{ date: '2026-11-20', time: '14:00' }, { date: '2026-11-20', time: '13:30' }, { date: '2026-11-20', time: '13:00' }]],
    ['closed_day (Monday)', {}, booking({ date: '2026-11-23' }), { date: 'closed_day' },
      [{ date: '2026-11-24', time: '19:00' }, { date: '2026-11-24', time: '18:30' }, { date: '2026-11-24', time: '19:30' }]],
    ['closed_day (special date)', {}, booking({ date: '2026-11-25' }), { date: 'closed_day' },
      [{ date: '2026-11-26', time: '19:00' }, { date: '2026-11-26', time: '18:30' }, { date: '2026-11-26', time: '19:30' }]],
    ['too_soon (3 h notice)', { noticeHours: 3 }, booking({ date: '2026-11-19', time: '12:00' }), { time: 'too_soon' },
      [{ date: '2026-11-19', time: '13:00' }, { date: '2026-11-19', time: '13:30' }, { date: '2026-11-19', time: '14:00' }]],
  ] as const)('AC-12 %s', async (_label, hoursPatch, body, fields, suggested) => {
    tenant({ bookingHours: { ...HOURS, ...hoursPatch } })
    const res = await post(body)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json).toMatchObject({ error: 'invalid_request', fields })
    expect(json.suggested_times).toEqual(suggested)
    expect(store.rows).toHaveLength(0)
  })

  it('AC-12 too_far → 400 with suggested_times inside the window', async () => {
    const res = await post(booking({ date: '2026-12-30' }))
    const json = await res.json()
    expect(json.fields).toEqual({ time: 'too_far' })
    expect(json.suggested_times.length).toBeGreaterThan(0)
    for (const s of json.suggested_times) expect(s.date <= '2026-12-19').toBe(true)
    expect(store.rows).toHaveLength(0)
  })

  it('AC-12 a non-hours error carries no suggested_times', async () => {
    const json = await (await post(booking({ party_size: 9 }))).json()
    expect(json.fields).toEqual({ party_size: 'too_large' })
    expect(json.suggested_times).toBeUndefined()
  })

  it('AC-12 a time on the grid books as before (202)', async () => {
    expect((await post(booking())).status).toBe(202)
    expect(store.rows).toHaveLength(1)
  })
})

describe('AC-13 terms: required, stored on the row', () => {
  beforeEach(() => tenant({ bookingHours: { ...HOURS, terms: TERMS } }))

  it('AC-13 without accept_terms → 400 fields.accept_terms terms_required, nothing stored', async () => {
    const json = await (await post(booking())).json()
    expect(json).toMatchObject({ error: 'invalid_request', fields: { accept_terms: 'terms_required' } })
    expect(store.rows).toHaveLength(0)
    expect((await (await post(booking({ accept_terms: false }))).json()).fields).toEqual({ accept_terms: 'terms_required' })
  })

  it('AC-13 accept_terms not a boolean → 400 invalid', async () => {
    expect((await (await post(booking({ accept_terms: 'yes' }))).json()).fields).toEqual({ accept_terms: 'invalid' })
  })

  it('AC-13 accept_terms: true → 202 and the row stores when and the exact text (zh-HK, blank line, en)', async () => {
    expect((await post(booking({ accept_terms: true }))).status).toBe(202)
    expect(store.rows[0]).toMatchObject({
      termsAcceptedAt: '2026-11-19T02:00:00.000Z',
      termsText: `${TERMS.zh_hk}\n\n${TERMS.en}`,
    })
  })
})

describe('AC-14 hours not set: POST unchanged, accept_terms accepted but not required', () => {
  beforeEach(() => tenant({ bookingHours: null }))

  it('AC-14 any time books; accept_terms true is accepted and stores nothing', async () => {
    expect((await post(booking({ time: '03:00' }))).status).toBe(202)
    expect((await post(booking({ time: '03:30', accept_terms: true }))).status).toBe(202)
    for (const row of store.rows) expect(row.termsAcceptedAt).toBeUndefined()
  })
})

describe('AC-11 OpenAPI route carries the hours only when set', () => {
  const openapi = async () => (await GET_OPENAPI(new Request('https://x'), { params: Promise.resolve({ publicId: PID }) })).json()

  it('AC-11 hours set → /availability listed and the summary in the description', async () => {
    const doc = await openapi()
    expect(Object.keys(doc.paths)).toContain('/availability')
    expect(doc.info.description).toContain('Diners can book')
  })

  it('AC-14 hours null → no /availability path, no summary', async () => {
    tenant({ bookingHours: null })
    const doc = await openapi()
    expect(Object.keys(doc.paths)).toEqual(['/bookings', '/bookings/{booking_id}'])
    expect(doc.info.description).not.toContain('Diners can book')
  })
})

describe('F1 P3-4: /availability query edges', () => {
  it('days = aheadDays + 1 covers the whole window in one call', async () => {
    tenant({ bookingHours: { ...HOURS, aheadDays: 7 } })
    const res = await availability('from=2026-11-19&days=8')
    expect(res.status).toBe(200)
    const dates = (await res.json()).dates as DateRow[]
    expect(dates.at(-1)).toMatchObject({ date: '2026-11-26', open: true })
    expect((await availability('from=2026-11-19&days=9')).status).toBe(400)
  })

  it('from past today + max(aheadDays, 90) → 400 too_far; the reach itself is fine', async () => {
    const far = await (await availability('from=9999-12-31&days=3')).json()
    expect(far).toMatchObject({ error: 'invalid_request', fields: { from: 'too_far' } })
    expect((await availability('from=2027-02-17&days=1')).status).toBe(200) // today + 90
    expect((await (await availability('from=2027-02-18&days=1')).json()).fields).toEqual({ from: 'too_far' })
    tenant({ bookingHours: null })
    expect((await (await availability('from=2027-02-18&days=1')).json()).fields).toEqual({ from: 'too_far' })
  })
})

describe('F1 P2-1: the schedule switch off', () => {
  const OFF = { ...HOURS, scheduleEnabled: false }
  const openapi = async () => (await GET_OPENAPI(new Request('https://x'), { params: Promise.resolve({ publicId: PID }) })).json()

  it('PAP POST takes any time again; terms still need accept_terms', async () => {
    tenant({ bookingHours: OFF })
    expect((await post(booking({ date: '2026-11-23', time: '03:00' }))).status).toBe(202)
    tenant({ bookingHours: { ...OFF, terms: TERMS } })
    expect((await (await post(booking({ time: '03:15' }))).json()).fields).toEqual({ accept_terms: 'terms_required' })
    expect((await post(booking({ time: '03:15', accept_terms: true }))).status).toBe(202)
  })

  it('/availability: every date open at any time, with the table time and terms', async () => {
    tenant({ bookingHours: { ...OFF, terms: TERMS } })
    const body = await (await availability('from=2026-11-23&days=3')).json()
    expect(body.dates).toEqual(['2026-11-23', '2026-11-24', '2026-11-25'].map((date) => ({ date, open: true, times: null })))
    expect(body).toMatchObject({ interval_minutes: null, table_minutes: 120, terms: { 'zh-HK': TERMS.zh_hk, en: TERMS.en } })
  })

  it('OpenAPI: no schedule summary, no /availability, no suggested_times; the terms and table time are stated', async () => {
    tenant({ bookingHours: { ...OFF, terms: TERMS } })
    const doc = await openapi()
    expect(Object.keys(doc.paths)).toEqual(['/bookings', '/bookings/{booking_id}'])
    expect(doc.info.description).not.toContain('Diners can book')
    expect(doc.info.description).toContain('Tables are for 2 hours.')
    expect(doc.info.description).toContain(`Terms: ${TERMS.en}`)
    expect(doc.paths['/bookings'].post.requestBody.content['application/json'].schema.required).toContain('accept_terms')
    expect(doc.components.schemas.Error.properties.suggested_times).toBeUndefined()
  })

  it('AC-5: switch off and nothing else set → the same document as hours null', async () => {
    tenant({ bookingHours: { ...OFF, tableMinutes: null } })
    const off = await openapi()
    tenant({ bookingHours: null })
    expect(off).toEqual(await openapi())
  })
})

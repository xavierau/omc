/**
 * BOOK-010 (spec S3, AC-8..AC-11, threat R3): staff read how full a day is,
 * stop and resume bookings for a day / period / slot, and confirming over a
 * limit asks first but never blocks. Tenant from the session; admin or
 * staff; every read and write scoped by restaurant.
 * Now: 2026-11-20 03:00 UTC = Fri 11:00 HK; 2026-11-21 is a Saturday.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { FakeBookingRequests, FakeBookingSender, FakeBookingSettings } from '@/test-utils/fake-booking'
import { FakeBookingRoom } from '@/application/booking/__tests__/fake-booking-room'
import type { BookingCapacityDeps } from '@/application/booking/booking-capacity'
import type { DecideBookingDeps } from '@/application/booking/decide-booking-request'
import { EMPTY_BOOKING_HOURS, type BookingHours } from '@/domain/value-objects/booking-hours'

const holder: { capacity: BookingCapacityDeps | null; decide: DecideBookingDeps | null } = { capacity: null, decide: null }

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/application/booking/booking-deps', () => ({
  bookingCapacityDeps: () => holder.capacity,
  decideBookingDeps: () => holder.decide,
}))

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { GET as capacity } from '../capacity/route'
import { DELETE as resume, POST as stop } from '../stops/route'
import { POST as confirm } from '../[id]/confirm/route'

const A = 'rest-a'
const B = 'rest-b'
const STAFF = '7c0f4a3e-0000-4000-8000-00000000aaaa'
const NOW = new Date('2026-11-20T03:00:00Z')
const DAY = '2026-11-21'
const lunchDinner = [
  { label: '午市', first: '12:00', last: '14:00' },
  { label: '晚市', first: '18:00', last: '21:30' },
]
const HOURS: BookingHours = {
  ...EMPTY_BOOKING_HOURS,
  weekly: { mon: lunchDinner, tue: lunchDinner, wed: lunchDinner, thu: lunchDinner, fri: lunchDinner, sat: lunchDinner, sun: [] },
  intervalMinutes: 30,
  limits: { perSlot: 30, perMeal: 60 },
}

let requests: FakeBookingRequests
let settings: FakeBookingSettings
let room: FakeBookingRoom

function seed(patch: Partial<FakeBookingRequests['rows'][number]>) {
  const row = {
    id: crypto.randomUUID(), restaurantId: A, memberId: null, phone: '+85290000001', name: 'Diner', partySize: 2, bookingDate: DAY,
    bookingTime: '19:00', notes: null, status: 'confirmed' as const, declineReason: null, decidedBy: null, decidedAt: null,
    source: 'chat' as const, campaignId: null, createdAt: '2026-11-18T00:00:00Z', decisionMessageStatus: null, token: null,
    replacesBookingId: null, cancelledBy: null, ...patch,
  }
  requests.rows.push(row as FakeBookingRequests['rows'][number])
  return row.id
}

beforeEach(() => {
  vi.clearAllMocks()
  requests = new FakeBookingRequests()
  settings = new FakeBookingSettings()
  settings.setConfig(A, { mode: 'simple', bookingHours: HOURS })
  settings.setConfig(B, { mode: 'simple', bookingHours: HOURS })
  room = new FakeBookingRoom(() => requests.rows)
  holder.capacity = {
    getConfig: (id) => settings.getConfig(id), room, stops: room, staffName: async () => 'Amy', now: () => NOW,
  }
  holder.decide = {
    requests, settings, sender: new FakeBookingSender(), now: () => NOW,
    overLimit: { getConfig: (id) => settings.getConfig(id), room },
  }
  vi.mocked(getTenantContext).mockResolvedValue({ userId: STAFF, restaurantId: A, role: 'staff', tenantStatus: 'active' })
})

const get = (query: string) => capacity(new NextRequest(`http://localhost/api/dashboard/bookings/capacity?${query}`))
const stopsReq = (method: 'POST' | 'DELETE', body: unknown) =>
  new NextRequest('http://localhost/api/dashboard/bookings/stops', { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
const confirmReq = (id: string, body?: unknown) =>
  confirm(
    new NextRequest(`http://localhost/api/dashboard/bookings/${id}/confirm`, { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) }),
    { params: Promise.resolve({ id }) }
  )

describe('GET capacity for a day (spec S3)', () => {
  it('per period guests / limit / slots and the day, with no-store', async () => {
    seed({ bookingTime: '19:00', partySize: 30 })
    seed({ bookingTime: '18:00', partySize: 6, status: 'pending' })
    seed({ bookingTime: '12:00', partySize: 4, status: 'declined' })
    seed({ bookingTime: '19:00', partySize: 9, restaurantId: B })
    const res = await get(`date=${DAY}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const body = await res.json()
    expect(body).toMatchObject({ date: DAY, hoursSet: true, full: false, stopped: false, stoppedBy: null, stoppedAt: null })
    const dinner = body.periods.find((p: { key: string }) => p.key === '晚市')
    expect(dinner).toMatchObject({ label: '晚市', first: '18:00', last: '21:30', guests: 36, limit: 60, stopped: false })
    expect(dinner.slots.find((s: { time: string }) => s.time === '19:00')).toEqual({
      time: '19:00', guests: 30, limit: 30, full: true, stopped: false, stoppedBy: null, stoppedAt: null,
    })
    expect(body.periods.find((p: { key: string }) => p.key === '午市').guests).toBe(0)
  })

  it('hours not set → hoursSet false, no periods', async () => {
    settings.setConfig(A, { mode: 'simple' })
    expect(await (await get(`date=${DAY}`)).json()).toMatchObject({ hoursSet: false, periods: [] })
  })

  it('month range → compact per-date {full, stopped} map for the badges', async () => {
    room.seedStop(A, { date: '2026-11-23', scope: 'day' })
    seed({ bookingDate: '2026-11-24', bookingTime: '12:00', partySize: 60 })
    seed({ bookingDate: '2026-11-24', bookingTime: '18:00', partySize: 60 })
    const body = await (await get('from=2026-11-01&to=2026-11-30')).json()
    expect(Object.keys(body.days)).toHaveLength(30)
    expect(body.days['2026-11-23']).toEqual({ full: true, stopped: true })
    expect(body.days['2026-11-24']).toEqual({ full: true, stopped: false })
    expect(body.days['2026-11-21']).toEqual({ full: false, stopped: false })
    expect(body.days['2026-11-22']).toEqual({ full: false, stopped: false })
  })

  it.each(['date=2026-13-01', 'from=2026-11-10&to=2026-11-01', 'from=2026-11-01&to=2027-02-01', ''])('400 on a bad query (%s)', async (q) => {
    expect((await get(q)).status).toBe(400)
  })
})

describe('POST / DELETE stops (spec AC-8, AC-9, AC-11)', () => {
  it('AC-8: stop 晚市 → stored with who and when; shown in capacity; idempotent; resume reopens', async () => {
    const res = await stop(stopsReq('POST', { date: DAY, scope: 'period', periodLabel: '晚市' }))
    expect(res.status).toBe(200)
    expect((await res.json()).stop).toEqual({
      date: DAY, scope: 'period', periodLabel: '晚市', time: null, stoppedBy: 'Amy', stoppedAt: NOW.toISOString(),
    })
    expect((await stop(stopsReq('POST', { date: DAY, scope: 'period', periodLabel: '晚市' }))).status).toBe(200)
    expect(room.stops).toHaveLength(1)
    expect(room.stops[0]).toMatchObject({ restaurantId: A, stoppedById: STAFF, stoppedByName: 'Amy' })
    const day = await (await get(`date=${DAY}`)).json()
    expect(day.periods.find((p: { key: string }) => p.key === '晚市')).toMatchObject({ stopped: true, stoppedBy: 'Amy' })
    expect((await resume(stopsReq('DELETE', { date: DAY, scope: 'period', periodLabel: '晚市' }))).status).toBe(200)
    expect((await resume(stopsReq('DELETE', { date: DAY, scope: 'period', periodLabel: '晚市' }))).status).toBe(200)
    expect(room.stops).toHaveLength(0)
  })

  it('AC-9: a day stop and a slot stop', async () => {
    expect((await stop(stopsReq('POST', { date: DAY, scope: 'day' }))).status).toBe(200)
    expect((await stop(stopsReq('POST', { date: DAY, scope: 'slot', time: '19:30' }))).status).toBe(200)
    expect(room.stops.map((s) => [s.scope, s.time])).toEqual([['day', null], ['slot', '19:30']])
  })

  it.each([
    ['a past date', { date: '2026-11-19', scope: 'day' }, { date: 'past' }],
    ['a bad date', { date: '21/11/2026', scope: 'day' }, { date: 'invalid' }],
    ['a bad scope', { date: DAY, scope: 'week' }, { scope: 'invalid' }],
    ['a period that is not on that date', { date: DAY, scope: 'period', periodLabel: '早市' }, { periodLabel: 'unknown_period' }],
    ['a slot that is not on the grid', { date: DAY, scope: 'slot', time: '19:15' }, { time: 'unknown_slot' }],
    ['a closed day’s period', { date: '2026-11-22', scope: 'period', periodLabel: '晚市' }, { periodLabel: 'unknown_period' }],
  ])('400 on %s; nothing stored', async (_l, body, fields) => {
    const res = await stop(stopsReq('POST', body))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid', fields })
    expect(room.stops).toHaveLength(0)
  })

  it('400 on a past date for resume too', async () => {
    expect((await resume(stopsReq('DELETE', { date: '2026-11-19', scope: 'day' }))).status).toBe(400)
  })

  it('AC-11: a role other than admin/staff → 403, nothing stored', async () => {
    vi.mocked(getTenantContext).mockResolvedValue({ userId: STAFF, restaurantId: A, role: 'viewer', tenantStatus: 'active' })
    expect((await stop(stopsReq('POST', { date: DAY, scope: 'day' }))).status).toBe(403)
    expect((await resume(stopsReq('DELETE', { date: DAY, scope: 'day' }))).status).toBe(403)
    expect(room.stops).toHaveLength(0)
  })

  it('AC-11: no access to the tenant (guard) → 403; stops are scoped to the session tenant', async () => {
    room.seedStop(B, { date: DAY, scope: 'day' })
    expect((await (await get(`date=${DAY}`)).json()).stopped).toBe(false)
    await resume(stopsReq('DELETE', { date: DAY, scope: 'day' }))
    expect(room.stops).toHaveLength(1)
    vi.mocked(getTenantContext).mockRejectedValue(new AuthError('Forbidden: no access to tenant', 403))
    expect((await stop(stopsReq('POST', { date: DAY, scope: 'day' }))).status).toBe(403)
    expect((await get(`date=${DAY}`)).status).toBe(403)
  })
})

describe('AC-10 confirm over a limit asks first, never blocks', () => {
  it('AC-10: 30 confirmed + a pending 4 at 19:00 → 409 overLimit; confirmAnyway → confirmed', async () => {
    seed({ partySize: 30 })
    const id = seed({ partySize: 4, status: 'pending', bookingDate: DAY })
    const first = await confirmReq(id)
    expect(first.status).toBe(409)
    expect(await first.json()).toEqual({ error: 'over_limit', overLimit: { scope: 'slot', time: '19:00', guests: 34, limit: 30 } })
    expect(requests.rows.find((r) => r.id === id)?.status).toBe('pending')
    const second = await confirmReq(id, { confirmAnyway: true })
    expect(second.status).toBe(200)
    expect(requests.rows.find((r) => r.id === id)?.status).toBe('confirmed')
  })

  it('the meal limit too', async () => {
    seed({ bookingTime: '18:00', partySize: 30 })
    seed({ bookingTime: '18:30', partySize: 30 })
    const id = seed({ bookingTime: '20:00', partySize: 4, status: 'pending' })
    expect(await (await confirmReq(id)).json()).toEqual({
      error: 'over_limit', overLimit: { scope: 'meal', period: '晚市', guests: 64, limit: 60 },
    })
  })

  it('within the limits → confirmed straight away', async () => {
    const id = seed({ partySize: 4, status: 'pending' })
    expect((await confirmReq(id)).status).toBe(200)
  })

  it('a change request: the original it replaces does not count against it', async () => {
    const original = seed({ partySize: 4, phone: '+85290000009' })
    seed({ partySize: 26 })
    const change = seed({ partySize: 4, status: 'pending', replacesBookingId: original, phone: '+85290000009' })
    expect((await confirmReq(change)).status).toBe(200)
    expect(requests.rows.find((r) => r.id === original)?.status).toBe('cancelled')
  })

  it('AC-3: no limits → never asks', async () => {
    settings.setConfig(A, { mode: 'simple', bookingHours: { ...HOURS, limits: undefined } })
    seed({ partySize: 300 })
    const id = seed({ partySize: 4, status: 'pending' })
    expect((await confirmReq(id)).status).toBe(200)
  })
})

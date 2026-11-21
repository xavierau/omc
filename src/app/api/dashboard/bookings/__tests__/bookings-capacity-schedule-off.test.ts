/**
 * BOOK-010 I-010: with BOOK-009's schedule switch off, room rules do not
 * apply for staff either: the capacity read says the hours are off (no
 * periods, no switches), month badges are empty, stops are refused, and
 * confirming never asks about limits. Limits and stops stay stored, so
 * switching back on restores them.
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
import { GET as capacity } from '../capacity/route'
import { POST as stop } from '../stops/route'
import { POST as confirm } from '../[id]/confirm/route'

const A = 'rest-a'
const STAFF = '7c0f4a3e-0000-4000-8000-00000000aaaa'
const NOW = new Date('2026-11-20T03:00:00Z')
const DAY = '2026-11-21'
const lunchDinner = [
  { label: '午市', first: '12:00', last: '14:00' },
  { label: '晚市', first: '18:00', last: '21:30' },
]
const ON: BookingHours = {
  ...EMPTY_BOOKING_HOURS,
  weekly: { mon: lunchDinner, tue: lunchDinner, wed: lunchDinner, thu: lunchDinner, fri: lunchDinner, sat: lunchDinner, sun: [] },
  intervalMinutes: 30,
  limits: { perSlot: 30, perMeal: 60 },
}
const OFF: BookingHours = { ...ON, scheduleEnabled: false }

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
  settings.setConfig(A, { mode: 'simple', bookingHours: OFF })
  room = new FakeBookingRoom(() => requests.rows)
  holder.capacity = { getConfig: (id) => settings.getConfig(id), room, stops: room, staffName: async () => 'Amy', now: () => NOW }
  holder.decide = {
    requests, settings, sender: new FakeBookingSender(), now: () => NOW,
    overLimit: { getConfig: (id) => settings.getConfig(id), room },
  }
  vi.mocked(getTenantContext).mockResolvedValue({ userId: STAFF, restaurantId: A, role: 'staff', tenantStatus: 'active' })
})

const get = (query: string) => capacity(new NextRequest(`http://localhost/api/dashboard/bookings/capacity?${query}`))
const stopReq = (body: unknown) =>
  new NextRequest('http://localhost/api/dashboard/bookings/stops', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
const confirmReq = (id: string) => confirm(new NextRequest(`http://localhost/api/dashboard/bookings/${id}/confirm`, { method: 'POST' }), { params: Promise.resolve({ id }) })

describe('schedule switch off: staff capacity', () => {
  it('day read → hours set but off, no periods (the block says "Booking hours are off")', async () => {
    seed({ partySize: 30 })
    const body = await (await get(`date=${DAY}`)).json()
    expect(body).toMatchObject({ date: DAY, hoursSet: true, hoursOff: true, full: false, stopped: false, periods: [] })
  })

  it('a stop stored while on is not reported while off; month badges are empty', async () => {
    room.seedStop(A, { date: DAY, scope: 'day' })
    seed({ partySize: 30 })
    expect((await (await get(`date=${DAY}`)).json()).stopped).toBe(false)
    const month = await (await get(`from=${DAY}&to=2026-11-23`)).json()
    expect(Object.values(month.days)).toEqual([{ full: false, stopped: false }, { full: false, stopped: false }, { full: false, stopped: false }])
  })

  it('stopping is refused while off (hours_not_set), nothing stored', async () => {
    const res = await stop(stopReq({ date: DAY, scope: 'day' }))
    expect(res.status).toBe(400)
    expect(room.stops).toHaveLength(0)
  })

  it('confirming over a stored limit never asks while off', async () => {
    seed({ partySize: 30 })
    const id = seed({ partySize: 4, status: 'pending' })
    expect((await confirmReq(id)).status).toBe(200)
  })

  it('switching back on restores the limits and stops', async () => {
    room.seedStop(A, { date: DAY, scope: 'day' })
    settings.setConfig(A, { mode: 'simple', bookingHours: ON })
    const body = await (await get(`date=${DAY}`)).json()
    expect(body).toMatchObject({ hoursSet: true, stopped: true })
    expect(body.hoursOff).toBeUndefined()
    expect(body.periods.length).toBeGreaterThan(0)
  })
})

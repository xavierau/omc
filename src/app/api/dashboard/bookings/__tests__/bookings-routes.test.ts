import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { FakeBookingRequests, FakeBookingSender, FakeBookingSettings } from '@/test-utils/fake-booking'
import type { DecideBookingDeps } from '@/application/booking/decide-booking-request'

const store: { requests: FakeBookingRequests; deps: DecideBookingDeps | null } = {
  requests: new FakeBookingRequests(),
  deps: null,
}

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/application/booking/booking-deps', () => ({ decideBookingDeps: () => store.deps }))
vi.mock('@/infrastructure/supabase/repositories/booking-request-repository', () => ({
  listBookingRequests: (restaurantId: string, limit: number) => store.requests.listForRestaurant(restaurantId, limit),
  findBookingForRestaurant: (id: string, restaurantId: string) => store.requests.findForRestaurant(id, restaurantId),
}))

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { GET as list } from '../route'
import { GET as getOne } from '../[id]/route'
import { POST as confirm } from '../[id]/confirm/route'
import { POST as decline } from '../[id]/decline/route'

const A = 'rest-a'
const B = 'rest-b'
let sender: FakeBookingSender
let idA1: string
let idA2: string
let idB: string

async function seed(restaurantId: string, token: string) {
  const row = await store.requests.insert({
    restaurantId, memberId: null, phone: '+85291234567', name: 'Chan', partySize: 2, bookingDate: '2026-11-13',
    bookingTime: '19:30', notes: '<script>alert(1)</script>', source: 'chat', campaignId: null, token,
  })
  return row.id
}

beforeEach(async () => {
  vi.clearAllMocks()
  store.requests = new FakeBookingRequests()
  sender = new FakeBookingSender()
  store.deps = { requests: store.requests, settings: new FakeBookingSettings(), sender, now: () => new Date('2026-11-12T03:00:00Z') }
  idA1 = await seed(A, 't1')
  idB = await seed(B, 't2')
  idA2 = await seed(A, 't3')
  vi.mocked(getTenantContext).mockResolvedValue({ userId: 'user-a', restaurantId: A, role: 'staff', tenantStatus: 'active' })
})

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const req = (body: unknown = {}) =>
  new NextRequest('http://localhost/api/dashboard/bookings/x', { method: 'POST', body: JSON.stringify(body) })

describe('dashboard bookings API', () => {
  it("R6/AC-13: the list returns only this restaurant's rows, newest first", async () => {
    const res = await list()
    const { bookings } = await res.json()
    expect(bookings.map((b: { id: string }) => b.id)).toEqual([idA2, idA1])
  })

  it("R6: get, confirm and decline on another tenant's id → 404, and B is unchanged", async () => {
    expect((await getOne(new Request('http://x'), ctx(idB))).status).toBe(404)
    expect((await confirm(req(), ctx(idB))).status).toBe(404)
    expect((await decline(req({ reason: 'x' }), ctx(idB))).status).toBe(404)
    expect(store.requests.rows.find((r) => r.id === idB)).toMatchObject({ status: 'pending', decidedBy: null })
    expect(sender.sent).toHaveLength(0)
  })

  it('R4: two confirms → one 200 and one 409 already handled; one message sent', async () => {
    const [first, second] = await Promise.all([confirm(req(), ctx(idA1)), confirm(req(), ctx(idA1))])
    expect([first.status, second.status].sort()).toEqual([200, 409])
    const conflict = first.status === 409 ? first : second
    expect(await conflict.json()).toEqual({ error: 'already_handled', status: 'confirmed' })
    expect(sender.sent).toHaveLength(1)
  })

  it('R5: confirm stores decided_by = the session user and decided_at; any member role may decide', async () => {
    const res = await confirm(req(), ctx(idA1))
    expect(res.status).toBe(200)
    expect(store.requests.rows.find((r) => r.id === idA1)).toMatchObject({
      status: 'confirmed', decidedBy: 'user-a', decidedAt: '2026-11-12T03:00:00.000Z',
    })
  })

  it('R5: decline stores who, when and the reason', async () => {
    await decline(req({ reason: 'Fully booked' }), ctx(idA1))
    expect(store.requests.rows.find((r) => r.id === idA1)).toMatchObject({
      status: 'declined', decidedBy: 'user-a', declineReason: 'Fully booked',
    })
    expect(sender.sent[0].kind).toBe('declined')
  })

  // F9 (review #7): decision with a failed send → reload → the list still
  // says the message was not delivered.
  it('a decision whose message failed is still marked not delivered in the list after a reload', async () => {
    sender.result = { delivered: false, reason: 'outside_window' }
    await confirm(req(), ctx(idA1))
    const { bookings } = await (await list()).json()
    expect(bookings.find((b: { id: string }) => b.id === idA1)).toMatchObject({ status: 'confirmed', decisionMessageStatus: 'not_delivered' })
  })

  // F10 (review #8): every pending request, plus the newest 200 decided ones.
  it('lists every pending request even behind more than 200 newer decided ones', async () => {
    for (let i = 0; i < 205; i++) {
      const id = await seed(A, `d${i}`)
      await store.requests.decide({ id, restaurantId: A, decision: 'confirmed', decidedBy: 'u', decidedAt: new Date(), declineReason: null })
    }
    const { bookings } = await (await list()).json()
    const ids = bookings.map((b: { id: string }) => b.id)
    expect(ids).toContain(idA1)
    expect(ids).toContain(idA2)
    expect(bookings.filter((b: { status: string }) => b.status === 'confirmed')).toHaveLength(200)
    expect(bookings.every((b: { restaurantId: string }) => b.restaurantId === A)).toBe(true)
  })

  it('AC-14 warning: delivered:false reaches the API response while the status is saved', async () => {
    sender.result = { delivered: false, reason: 'outside_window' }
    const res = await confirm(req(), ctx(idA1))
    expect(await res.json()).toMatchObject({ delivered: false, booking: { status: 'confirmed' } })
  })

  it('passes an auth failure through with its status', async () => {
    vi.mocked(getTenantContext).mockRejectedValue(new AuthError('Unauthorized', 401))
    expect((await list()).status).toBe(401)
    expect((await confirm(req(), ctx(idA1))).status).toBe(401)
  })
})

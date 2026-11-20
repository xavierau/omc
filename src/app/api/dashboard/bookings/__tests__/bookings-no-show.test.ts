/**
 * BOOK-007 AC-1 (R5, R6): staff mark a past confirmed booking as a no-show
 * (POST /api/dashboard/bookings/[id]/no-show) and undo it (DELETE). Tenant
 * from the session, any staff role, one conditional UPDATE; no message to
 * the diner either way.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { FakeBookingRequests } from '@/test-utils/fake-booking'
import type { BookingNoShowDeps } from '@/application/booking/booking-no-show'
import type { BookingRequest } from '@/domain/entities/booking-request'

const store: { requests: FakeBookingRequests; deps: BookingNoShowDeps | null } = { requests: new FakeBookingRequests(), deps: null }

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/application/booking/booking-deps', () => ({ noShowBookingDeps: () => store.deps }))
vi.mock('@/infrastructure/whatsapp/messaging', () => ({ sendTextMessage: vi.fn() }))
vi.mock('@/application/send-template-message', () => ({ sendWhatsAppTemplateMessage: vi.fn() }))

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { sendTextMessage } from '@/infrastructure/whatsapp/messaging'
import { sendWhatsAppTemplateMessage } from '@/application/send-template-message'
import { DELETE as undo, POST as mark } from '../[id]/no-show/route'

const A = 'rest-a'
const B = 'rest-b'
const STAFF = '7c0f4a3e-0000-4000-8000-00000000aaaa'
// 2026-11-20 03:00 UTC = 11:00 in Hong Kong.
const NOW = new Date('2026-11-20T03:00:00Z')

type Row = FakeBookingRequests['rows'][number]

function seed(extra: Partial<Row>): string {
  const row: Row = {
    id: crypto.randomUUID(), restaurantId: A, memberId: null, phone: '+85290000001', name: 'Test Diner', partySize: 2,
    bookingDate: '2026-11-19', bookingTime: '19:30', notes: null, status: 'confirmed', declineReason: null, decidedBy: 'u',
    decidedAt: '2026-11-18T00:00:00Z', source: 'chat', campaignId: null, createdAt: '2026-11-18T00:00:00Z',
    decisionMessageStatus: 'delivered', replacesBookingId: null, cancelledBy: null, token: null, ...extra,
  }
  store.requests.rows.push(row)
  return row.id
}

const rowOf = (id: string) => store.requests.rows.find((r) => r.id === id) as Row & Partial<BookingRequest>
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const req = (method: 'POST' | 'DELETE') => new NextRequest('http://localhost/api/dashboard/bookings/x/no-show', { method })

beforeEach(() => {
  vi.clearAllMocks()
  store.requests = new FakeBookingRequests()
  store.deps = { store: store.requests, now: () => NOW }
  vi.mocked(getTenantContext).mockResolvedValue({ userId: STAFF, restaurantId: A, role: 'staff', tenantStatus: 'active' })
})

describe('POST no-show (R5, R6)', () => {
  it('confirmed + past → no_show with who and when stored', async () => {
    const id = seed({})
    const res = await mark(req('POST'), ctx(id))
    expect(res.status).toBe(200)
    expect((await res.json()).booking).toMatchObject({ id, status: 'no_show' })
    expect(rowOf(id)).toMatchObject({ status: 'no_show', noShowMarkedBy: STAFF, noShowMarkedAt: NOW.toISOString() })
  })

  it('earlier today counts as past; an admin may mark too', async () => {
    vi.mocked(getTenantContext).mockResolvedValue({ userId: STAFF, restaurantId: A, role: 'admin', tenantStatus: 'active' })
    const id = seed({ bookingDate: '2026-11-20', bookingTime: '10:59' })
    expect((await mark(req('POST'), ctx(id))).status).toBe(200)
    expect(rowOf(id).status).toBe('no_show')
  })

  // r1 F3: a confirmed booking the server clock does not see as past yet is its own refusal, not "already handled".
  it.each([
    ['later today', { bookingDate: '2026-11-20', bookingTime: '11:00' }],
    ['a future date', { bookingDate: '2026-11-21', bookingTime: '09:00' }],
  ] as const)('confirmed + %s → 409 not_past, unchanged', async (_label, extra) => {
    const id = seed(extra)
    const before = { ...rowOf(id) }
    const res = await mark(req('POST'), ctx(id))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'not_past', status: 'confirmed' })
    expect(rowOf(id)).toEqual(before)
  })

  it.each([
    ['pending', { status: 'pending', decidedBy: null, decidedAt: null }],
    ['declined', { status: 'declined' }],
    ['cancelled', { status: 'cancelled', cancelledBy: 'diner_ai' }],
    ['already no_show', { status: 'no_show' }],
  ] as const)('%s → 409 already_handled, unchanged', async (_label, extra) => {
    const id = seed(extra as Partial<Row>)
    const before = { ...rowOf(id) }
    const res = await mark(req('POST'), ctx(id))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'already_handled', status: before.status })
    expect(rowOf(id)).toEqual(before)
  })

  // r1 F1: an original with an open (pending) change request is decided through the change, never marked.
  it('confirmed + past with an open change request → 409 change_pending; neither row changes', async () => {
    const original = seed({})
    const change = seed({ status: 'pending', decidedBy: null, decidedAt: null, replacesBookingId: original, source: 'agent' })
    const before = [{ ...rowOf(original) }, { ...rowOf(change) }]
    const res = await mark(req('POST'), ctx(original))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'change_pending', status: 'confirmed' })
    expect([rowOf(original), rowOf(change)]).toEqual(before)
  })

  it.each([
    ['declined', { status: 'declined' }],
    ['cancelled', { status: 'cancelled', cancelledBy: 'diner_ai' }],
    ['unverified', { status: 'unverified', decidedBy: null, decidedAt: null }],
  ] as const)('a %s change request is not open: the original is marked as before', async (_label, extra) => {
    const original = seed({})
    seed({ ...(extra as Partial<Row>), replacesBookingId: original, source: 'agent' })
    expect((await mark(req('POST'), ctx(original))).status).toBe(200)
    expect(rowOf(original).status).toBe('no_show')
  })

  it("another restaurant's pending row pointing at this id does not block the mark (the condition is tenant-scoped)", async () => {
    const original = seed({})
    seed({ restaurantId: B, status: 'pending', decidedBy: null, decidedAt: null, replacesBookingId: original })
    expect((await mark(req('POST'), ctx(original))).status).toBe(200)
    expect(rowOf(original).status).toBe('no_show')
  })

  it('an unverified agent booking does not exist for staff (BOOK-003 R41) → 404, unchanged', async () => {
    const id = seed({ status: 'unverified', decidedBy: null, decidedAt: null, source: 'agent' })
    expect((await mark(req('POST'), ctx(id))).status).toBe(404)
    expect(rowOf(id).status).toBe('unverified')
  })

  it("another tenant's id → 404, and its row is unchanged", async () => {
    const id = seed({ restaurantId: B })
    expect((await mark(req('POST'), ctx(id))).status).toBe(404)
    expect(rowOf(id)).toMatchObject({ status: 'confirmed' })
    expect(rowOf(id).noShowMarkedAt).toBeUndefined()
  })

  it('a non-UUID id → 404 without touching the store', async () => {
    seed({})
    const res = await mark(req('POST'), ctx("1' or 1=1"))
    expect(res.status).toBe(404)
    expect(store.requests.rows.every((r) => r.status === 'confirmed')).toBe(true)
  })

  it('a role other than admin or staff → 403, unchanged', async () => {
    vi.mocked(getTenantContext).mockResolvedValue({ userId: STAFF, restaurantId: A, role: 'viewer', tenantStatus: 'active' })
    const id = seed({})
    expect((await mark(req('POST'), ctx(id))).status).toBe(403)
    expect(rowOf(id).status).toBe('confirmed')
  })

  it('passes an auth failure through with its status', async () => {
    vi.mocked(getTenantContext).mockRejectedValue(new AuthError('Unauthorized', 401))
    expect((await mark(req('POST'), ctx(seed({})))).status).toBe(401)
    expect((await undo(req('DELETE'), ctx(seed({ status: 'no_show' })))).status).toBe(401)
  })
})

describe('DELETE no-show = undo (R5, R6)', () => {
  it('no_show → confirmed with both marker columns cleared', async () => {
    const id = seed({})
    await mark(req('POST'), ctx(id))
    const res = await undo(req('DELETE'), ctx(id))
    expect(res.status).toBe(200)
    expect((await res.json()).booking).toMatchObject({ id, status: 'confirmed' })
    expect(rowOf(id)).toMatchObject({ status: 'confirmed', noShowMarkedBy: null, noShowMarkedAt: null })
  })

  it.each(['confirmed', 'pending', 'declined', 'cancelled'] as const)('undo on a %s booking → 409, unchanged', async (status) => {
    const id = seed({ status })
    const before = { ...rowOf(id) }
    const res = await undo(req('DELETE'), ctx(id))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'already_handled', status })
    expect(rowOf(id)).toEqual(before)
  })

  it("undo on another tenant's no_show → 404, still no_show", async () => {
    const id = seed({ restaurantId: B, status: 'no_show' })
    expect((await undo(req('DELETE'), ctx(id))).status).toBe(404)
    expect(rowOf(id).status).toBe('no_show')
  })

  it('a non-UUID id → 404', async () => {
    expect((await undo(req('DELETE'), ctx('not-a-uuid'))).status).toBe(404)
  })
})

describe('no diner message (R5)', () => {
  it('neither mark nor undo sends anything to the diner', async () => {
    const id = seed({})
    await mark(req('POST'), ctx(id))
    await undo(req('DELETE'), ctx(id))
    expect(sendTextMessage).not.toHaveBeenCalled()
    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled()
    expect(Object.keys(store.deps as object).sort()).toEqual(['now', 'store'])
  })
})

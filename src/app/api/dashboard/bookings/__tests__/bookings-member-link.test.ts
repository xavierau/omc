/**
 * BOOK-008 AC-2 (R2, R4): staff link, relink or unlink a booking's member
 * (PATCH /api/dashboard/bookings/[id]/member, body { memberId: uuid | null }).
 * Tenant from the session, roles admin and staff; the booking and the target
 * member are both resolved inside the caller's restaurant, and any miss is a
 * 404 with nothing changed. Each change writes one events row
 * `booking.member_relinked` (actor + ids only); no change, no row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { FakeBookingRequests } from '@/test-utils/fake-booking'
import { FakeBookingMemberLinks, FakeMemberDirectory } from '@/test-utils/fake-booking-member'
import type { RelinkBookingMemberDeps } from '@/application/booking/relink-booking-member'

const world: { requests: FakeBookingRequests; members: FakeMemberDirectory; links: FakeBookingMemberLinks; deps: RelinkBookingMemberDeps | null } = {
  requests: new FakeBookingRequests(),
  members: new FakeMemberDirectory(),
  links: null as unknown as FakeBookingMemberLinks,
  deps: null,
}

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/application/booking/member-booking-deps', () => ({ relinkBookingMemberDeps: () => world.deps }))

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { PATCH } from '../[id]/member/route'

const A = 'rest-a'
const B = 'rest-b'
const STAFF = '7c0f4a3e-0000-4000-8000-00000000aaaa'
const PHONE = '+85290000001'

type Row = FakeBookingRequests['rows'][number]

function seed(extra: Partial<Row> = {}): string {
  const row: Row = {
    id: crypto.randomUUID(), restaurantId: A, memberId: null, phone: PHONE, name: 'Test Diner', partySize: 2,
    bookingDate: '2026-11-25', bookingTime: '19:30', notes: null, status: 'pending', declineReason: null, decidedBy: null,
    decidedAt: null, source: 'chat', campaignId: null, createdAt: '2026-11-18T00:00:00Z', decisionMessageStatus: null,
    replacesBookingId: null, cancelledBy: null, token: null, ...extra,
  }
  world.requests.rows.push(row)
  return row.id
}

const rowOf = (id: string) => world.requests.rows.find((r) => r.id === id) as Row
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const patch = (id: string, body: unknown) =>
  PATCH(
    new NextRequest(`http://localhost/api/dashboard/bookings/${id}/member`, {
      method: 'PATCH',
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }),
    ctx(id)
  )

let m1: string
let m2: string
let foreign: string

beforeEach(() => {
  vi.clearAllMocks()
  world.requests = new FakeBookingRequests()
  world.members = new FakeMemberDirectory()
  world.links = new FakeBookingMemberLinks(world.requests, world.members)
  world.deps = { store: world.links }
  m1 = world.members.add(A, PHONE)
  m2 = world.members.add(A, '+85290000002')
  foreign = world.members.add(B, PHONE)
  vi.mocked(getTenantContext).mockResolvedValue({ userId: STAFF, restaurantId: A, role: 'staff', tenantStatus: 'active' })
})

describe('PATCH member: link, relink, unlink (R2, R4)', () => {
  it('link (none → member) → 200 with the booking, one events row with actor and ids only', async () => {
    const id = seed()
    const res = await patch(id, { memberId: m1 })
    expect(res.status).toBe(200)
    expect((await res.json()).booking).toMatchObject({ id, memberId: m1 })
    expect(rowOf(id).memberId).toBe(m1)
    expect(world.links.events).toEqual([
      { restaurantId: A, memberId: null, type: 'booking.member_relinked', actorUserId: STAFF, data: { bookingId: id, fromMemberId: null, toMemberId: m1 } },
    ])
    expect(JSON.stringify(world.links.events)).not.toContain(PHONE)
    expect(JSON.stringify(world.links.events)).not.toContain('Test Diner')
  })

  it('relink (member → another member) → 200, one events row from → to; an admin may do it', async () => {
    vi.mocked(getTenantContext).mockResolvedValue({ userId: STAFF, restaurantId: A, role: 'admin', tenantStatus: 'active' })
    const id = seed({ memberId: m1 })
    expect((await patch(id, { memberId: m2 })).status).toBe(200)
    expect(rowOf(id).memberId).toBe(m2)
    expect(world.links.events.map((e) => e.data)).toEqual([{ bookingId: id, fromMemberId: m1, toMemberId: m2 }])
  })

  it('unlink (member → none) → 200, one events row to null', async () => {
    const id = seed({ memberId: m2 })
    const res = await patch(id, { memberId: null })
    expect(res.status).toBe(200)
    expect((await res.json()).booking.memberId).toBeNull()
    expect(rowOf(id).memberId).toBeNull()
    expect(world.links.events.map((e) => e.data)).toEqual([{ bookingId: id, fromMemberId: m2, toMemberId: null }])
  })

  it('nothing to change (already that member, or already unlinked) → 200 and no events row', async () => {
    const linked = seed({ memberId: m1 })
    const none = seed()
    expect((await patch(linked, { memberId: m1 })).status).toBe(200)
    expect((await patch(none, { memberId: null })).status).toBe(200)
    expect(world.links.events).toEqual([])
  })

  it('works on any staff-visible status (a past no-show or a declined booking too)', async () => {
    const noShow = seed({ status: 'no_show', bookingDate: '2026-11-01' })
    const declined = seed({ status: 'declined' })
    expect((await patch(noShow, { memberId: m1 })).status).toBe(200)
    expect((await patch(declined, { memberId: m1 })).status).toBe(200)
    expect(world.links.events).toHaveLength(2)
  })
})

// r1 F1 (/code-review PR #214): a relink left the open change request on the
// old member, so once staff confirmed the change the live booking was in the
// wrong person's history. The RPC moves the booking's open change requests in
// the same statement and the same compare-and-set on the old member.
describe('PATCH member: the open change request moves with the booking (r1 F1)', () => {
  const changeOf = (bookingId: string, memberId: string | null, extra: Partial<Row> = {}) =>
    seed({ memberId, replacesBookingId: bookingId, bookingDate: '2026-11-28', ...extra })

  it('relink with an open change → both rows on the new member; one events row naming the booking (+ changeIds)', async () => {
    const id = seed({ memberId: m1, status: 'confirmed', decidedAt: '2026-11-18T00:00:00Z' })
    const change = changeOf(id, m1)
    expect((await patch(id, { memberId: m2 })).status).toBe(200)
    expect(rowOf(id).memberId).toBe(m2)
    expect(rowOf(change).memberId).toBe(m2)
    expect(world.links.events).toHaveLength(1)
    expect(world.links.events[0].data).toEqual({ bookingId: id, fromMemberId: m1, toMemberId: m2, changeIds: [change] })
  })

  it('confirmed later → the live booking (the change row) is on the new member, the original is the cancelled one', async () => {
    const id = seed({ memberId: m1, status: 'confirmed', decidedAt: '2026-11-18T00:00:00Z' })
    const change = changeOf(id, m1)
    await patch(id, { memberId: m2 })
    await world.requests.confirmChange({ id: change, restaurantId: A, decidedBy: STAFF, decidedAt: new Date('2026-11-20T03:00:00Z') })
    const live = world.requests.rows.filter((r) => r.memberId === m2 && r.status === 'confirmed').map((r) => r.id)
    expect(live).toEqual([change])
    expect(rowOf(id)).toMatchObject({ status: 'cancelled', cancelledBy: 'change', memberId: m2 })
  })

  it('unlink moves the open change too; decided changes, other bookings and other tenants are untouched', async () => {
    const id = seed({ memberId: m1, status: 'confirmed', decidedAt: '2026-11-18T00:00:00Z' })
    const open = changeOf(id, m1)
    const declined = changeOf(id, m1, { status: 'declined', decidedAt: '2026-11-19T00:00:00Z' })
    const otherBooking = seed({ memberId: m1 })
    const otherTenant = changeOf(id, m1, { restaurantId: B })
    expect((await patch(id, { memberId: null })).status).toBe(200)
    expect(rowOf(open).memberId).toBeNull()
    expect([rowOf(declined).memberId, rowOf(otherBooking).memberId, rowOf(otherTenant).memberId]).toEqual([m1, m1, m1])
  })

  it('a change row that no longer holds the old member is left alone (same compare-and-set)', async () => {
    const id = seed({ memberId: m1, status: 'confirmed', decidedAt: '2026-11-18T00:00:00Z' })
    const change = changeOf(id, null)
    await patch(id, { memberId: m2 })
    expect(rowOf(change).memberId).toBeNull()
    expect(world.links.events[0].data).toEqual({ bookingId: id, fromMemberId: m1, toMemberId: m2 })
  })
})

describe('PATCH member: tenant scope and validation (R2)', () => {
  const expectUnchanged = (id: string, memberId: string | null) => {
    expect(rowOf(id).memberId).toBe(memberId)
    expect(world.links.events).toEqual([])
  }

  it("another tenant's booking → 404, nothing changed, no event", async () => {
    const id = seed({ restaurantId: B, memberId: null })
    const res = await patch(id, { memberId: m1 })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
    expectUnchanged(id, null)
  })

  it("another tenant's member → 404, nothing changed, no event", async () => {
    const id = seed({ memberId: m1 })
    expect((await patch(id, { memberId: foreign })).status).toBe(404)
    expectUnchanged(id, m1)
  })

  it('an unknown member id → 404, nothing changed', async () => {
    const id = seed()
    expect((await patch(id, { memberId: '00000000-0000-4000-8000-000000000000' })).status).toBe(404)
    expectUnchanged(id, null)
  })

  it('an unverified agent booking does not exist for staff → 404, nothing changed', async () => {
    const id = seed({ status: 'unverified', source: 'agent' })
    expect((await patch(id, { memberId: m1 })).status).toBe(404)
    expectUnchanged(id, null)
  })

  it('a non-UUID booking id or member id → 404, nothing changed', async () => {
    const id = seed()
    expect((await patch('not-a-uuid', { memberId: m1 })).status).toBe(404)
    expect((await patch(id, { memberId: 'not-a-uuid' })).status).toBe(404)
    expect((await patch(id, { memberId: "' OR 1=1 --" })).status).toBe(404)
    expectUnchanged(id, null)
  })

  it.each([
    ['no memberId key', {}],
    ['a number', { memberId: 42 }],
    ['not JSON', '{nope'],
  ])('a body with %s → 400, nothing changed', async (_label, body) => {
    const id = seed()
    const res = await patch(id, body)
    expect(res.status).toBe(400)
    expectUnchanged(id, null)
  })

  it('the link changed under us (compare-and-set miss) → 409, no event', async () => {
    const id = seed({ memberId: m1 })
    const relink = world.links.relink.bind(world.links)
    world.links.relink = async (args) => {
      rowOf(id).memberId = m2 // another staff member relinked it first
      return relink(args)
    }
    const res = await patch(id, { memberId: null })
    expect(res.status).toBe(409)
    expect(rowOf(id).memberId).toBe(m2)
    expect(world.links.events).toEqual([])
  })
})

// r1 F5 (/code-review PR #214): a relink that changed no row was always 409;
// when the target member was deleted in between it is a 404, like a member
// that was never there.
describe('PATCH member: no row changed is re-checked (r1 F5)', () => {
  it('the target member was deleted between the lookup and the write → 404 not_found, no event', async () => {
    const id = seed()
    const relink = world.links.relink.bind(world.links)
    world.links.relink = async (args) => {
      world.members.rows.splice(world.members.rows.findIndex((m) => m.id === m2), 1)
      return relink(args)
    }
    const res = await patch(id, { memberId: m2 })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
    expect(rowOf(id).memberId).toBeNull()
    expect(world.links.events).toEqual([])
  })

  it('the target member still exists → 409 changed', async () => {
    const id = seed({ memberId: m1 })
    const relink = world.links.relink.bind(world.links)
    world.links.relink = async (args) => {
      rowOf(id).memberId = null
      return relink(args)
    }
    const res = await patch(id, { memberId: m2 })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'changed' })
  })
})

describe('PATCH member: roles and auth', () => {
  it('a role other than admin or staff → 403, nothing changed', async () => {
    vi.mocked(getTenantContext).mockResolvedValue({ userId: STAFF, restaurantId: A, role: 'viewer', tenantStatus: 'active' })
    const id = seed()
    expect((await patch(id, { memberId: m1 })).status).toBe(403)
    expect(rowOf(id).memberId).toBeNull()
    expect(world.links.events).toEqual([])
  })

  it('no session → the AuthError status, nothing changed', async () => {
    vi.mocked(getTenantContext).mockRejectedValue(new AuthError('Unauthorized', 401))
    const id = seed()
    expect((await patch(id, { memberId: m1 })).status).toBe(401)
    expect(rowOf(id).memberId).toBeNull()
  })

  it('a store failure → 500 with a generic error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    world.links.failRelink = true
    const id = seed()
    const res = await patch(id, { memberId: m1 })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to update booking' })
  })
})

// BOOK-013 AC-26 (decision 9, owner default 2026-11-27): a booking without a
// phone cannot be linked by hand; the next phone-less save would drop the link.
// Adding a phone (AC-28) is the way to link. Unlinking stays allowed.
describe('PATCH member: a booking without a phone (BOOK-013 AC-26)', () => {
  it('link on a phone-less booking → 400 phone_required, member_id unchanged, no events row', async () => {
    const id = seed({ phone: null, source: 'staff', status: 'confirmed' })
    const res = await patch(id, { memberId: m1 })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'phone_required' })
    expect(rowOf(id).memberId).toBeNull()
    expect(world.links.events).toEqual([])
  })

  it('relink on a phone-less booking that still holds a member → 400 phone_required, link unchanged', async () => {
    const id = seed({ phone: null, source: 'staff', status: 'confirmed', memberId: m1 })
    const res = await patch(id, { memberId: m2 })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'phone_required' })
    expect(rowOf(id).memberId).toBe(m1)
    expect(world.links.events).toEqual([])
  })

  it('unlink on a phone-less booking is still allowed → 200, one events row to null', async () => {
    const id = seed({ phone: null, source: 'staff', status: 'confirmed', memberId: m1 })
    expect((await patch(id, { memberId: null })).status).toBe(200)
    expect(rowOf(id).memberId).toBeNull()
    expect(world.links.events.map((e) => e.data)).toEqual([{ bookingId: id, fromMemberId: m1, toMemberId: null }])
  })

  it('a staff booking with a phone still links as before → 200', async () => {
    const id = seed({ source: 'staff', status: 'confirmed' })
    expect((await patch(id, { memberId: m1 })).status).toBe(200)
    expect(rowOf(id).memberId).toBe(m1)
  })

  it("another tenant's phone-less booking is still 404, not phone_required", async () => {
    const id = seed({ phone: null, source: 'staff', status: 'confirmed', restaurantId: B })
    expect((await patch(id, { memberId: m1 })).status).toBe(404)
  })
})

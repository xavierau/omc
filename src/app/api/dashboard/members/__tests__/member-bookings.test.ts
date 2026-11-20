/**
 * BOOK-008 AC-3 (R8, R2): the member detail GET carries the member's
 * bookings (newest 50 by booking date and time) and stats over ALL of them,
 * both scoped by restaurant AND member, unverified excluded. A failed or
 * unavailable read answers bookingHistory: null and the rest of the panel
 * still loads. The SQL itself: booking-member-repository.test.ts (shape) and
 * the AC-6 scratch-DB log (semantics).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { FakeMemberBookings, type FakeMemberBookingRow } from '@/test-utils/fake-booking-member'
import type { MemberBookingHistoryDeps } from '@/application/booking/get-member-booking-history'

const world: { reader: FakeMemberBookings; deps: MemberBookingHistoryDeps | null } = { reader: new FakeMemberBookings(), deps: null }

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/infrastructure/supabase/repositories/member-detail-repository')
vi.mock('@/infrastructure/supabase/repositories/member-quality-evidence')
vi.mock('@/application/booking/member-booking-deps', () => ({ memberBookingHistoryDeps: () => world.deps }))

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { getMemberDetailForRestaurant } from '@/infrastructure/supabase/repositories/member-detail-repository'
import { getMemberQualityEvidenceSafe } from '@/infrastructure/supabase/repositories/member-quality-evidence'
import { GET } from '../route'

const A = 'rest-a'
const B = 'rest-b'
const MEMBER = '5d1b0c2e-0000-4000-8000-000000000001'
const OTHER_MEMBER = '5d1b0c2e-0000-4000-8000-000000000002'
// 2026-11-20 03:00 UTC = 11:00 in Hong Kong.
const NOW = new Date('2026-11-20T03:00:00Z')

const detail = { id: MEMBER, phone: '+85290000001', name: 'Test Member', points_balance: 0, restaurant_id: A, receipts: [], coupons: [], visitCount: 0 }

let n = 0
function seed(extra: Partial<FakeMemberBookingRow> = {}) {
  const row: FakeMemberBookingRow = {
    id: `b-${String(++n).padStart(3, '0')}`, restaurantId: A, memberId: MEMBER, bookingDate: '2026-10-01', bookingTime: '19:00',
    partySize: 2, status: 'confirmed', ...extra,
  }
  world.reader.rows.push(row)
  return row
}

const get = async (id = MEMBER) => (await GET(new NextRequest(`http://localhost/api/dashboard/members?id=${id}`))).json()

beforeEach(() => {
  vi.clearAllMocks()
  n = 0
  world.reader = new FakeMemberBookings()
  world.deps = { reader: world.reader, now: () => NOW }
  vi.mocked(getTenantContext).mockResolvedValue({ userId: 'u-1', restaurantId: A, role: 'staff', tenantStatus: 'active' })
  vi.mocked(getMemberDetailForRestaurant).mockResolvedValue(detail as never)
  vi.mocked(getMemberQualityEvidenceSafe).mockResolvedValue(null)
})
afterEach(() => vi.restoreAllMocks())

describe('member detail GET: bookings + stats (R8)', () => {
  it('60 bookings → the newest 50 by date then time; stats over all 60, no_show included', async () => {
    const statuses = ['confirmed', 'no_show', 'cancelled', 'declined', 'pending'] as const
    for (let i = 0; i < 60; i++) {
      const day = String((i % 28) + 1).padStart(2, '0')
      const month = i < 28 ? '09' : i < 56 ? '10' : '11'
      seed({ bookingDate: `2026-${month}-${day}`, bookingTime: i % 2 ? '12:30' : '19:30', status: statuses[i % 5] })
    }
    const json = await get()
    const { bookings, stats } = json.bookingHistory
    expect(bookings).toHaveLength(50)
    const keys = bookings.map((b: { bookingDate: string; bookingTime: string }) => `${b.bookingDate} ${b.bookingTime}`)
    expect(keys).toEqual([...keys].sort().reverse())
    expect(bookings[0]).toEqual({ id: 'b-060', bookingDate: '2026-11-04', bookingTime: '12:30', partySize: 2, status: 'pending' })
    expect(stats).toEqual({
      total: 60, confirmed: 12, noShow: 12, cancelled: 12, declined: 12, pending: 12,
      // r1 F2: last = the latest past confirmed or no_show date (11-01 no_show), not 11-04's pending row.
      lastBookingDate: '2026-11-01', nextBookingDate: null,
    })
  })

  it("another member's, another tenant's and unverified bookings are never included", async () => {
    seed({ id: 'mine', bookingDate: '2026-11-25', status: 'pending' })
    seed({ id: 'other-member', memberId: OTHER_MEMBER })
    seed({ id: 'other-tenant', restaurantId: B })
    seed({ id: 'unverified', status: 'unverified' })
    seed({ id: 'unlinked', memberId: null })
    const { bookingHistory } = await get()
    expect(bookingHistory.bookings.map((b: { id: string }) => b.id)).toEqual(['mine'])
    expect(bookingHistory.stats).toMatchObject({ total: 1, pending: 1, nextBookingDate: '2026-11-25', lastBookingDate: null })
  })

  it('reads with the caller tenant, the member id, the cap of 50 and the Hong Kong now', async () => {
    vi.mocked(getTenantContext).mockResolvedValue({ userId: 'u-1', restaurantId: B, role: 'admin', tenantStatus: 'active' })
    await get()
    expect(world.reader.calls).toEqual([
      ['list', MEMBER, B, 50],
      ['stats', MEMBER, B, { date: '2026-11-20', time: '11:00' }],
    ])
  })

  it('last = latest date before now (earlier today counts); next = earliest pending/confirmed from now on', async () => {
    seed({ bookingDate: '2026-11-20', bookingTime: '10:30', status: 'confirmed' })
    seed({ bookingDate: '2026-11-20', bookingTime: '11:00', status: 'declined' })
    seed({ bookingDate: '2026-11-22', bookingTime: '19:00', status: 'cancelled' })
    seed({ bookingDate: '2026-11-24', bookingTime: '19:00', status: 'confirmed' })
    const { stats } = (await get()).bookingHistory
    expect(stats.lastBookingDate).toBe('2026-11-20')
    expect(stats.nextBookingDate).toBe('2026-11-24')
  })

  // r1 F2 (/code-review PR #214): stats count reservations, not rows. A confirmed change
  // leaves the original cancelled by 'change' and the change row confirmed: one reservation.
  it('a changed-then-confirmed booking counts 1 total, 0 cancelled; both rows stay in the list', async () => {
    seed({ id: 'original', bookingDate: '2026-11-10', status: 'cancelled', cancelledBy: 'change' })
    seed({ id: 'change', bookingDate: '2026-11-12', status: 'confirmed', replacesBookingId: 'original' })
    const { bookings, stats } = (await get()).bookingHistory
    expect(bookings.map((b: { id: string }) => b.id)).toEqual(['change', 'original'])
    expect(stats).toEqual({
      total: 1, confirmed: 1, cancelled: 0, declined: 0, noShow: 0, pending: 0,
      lastBookingDate: '2026-11-12', nextBookingDate: null,
    })
  })

  it('an open or declined change request is not a reservation; a diner cancellation still counts', async () => {
    seed({ id: 'booking', bookingDate: '2026-11-25', status: 'confirmed' })
    seed({ id: 'open-change', bookingDate: '2026-11-26', status: 'pending', replacesBookingId: 'booking' })
    seed({ id: 'declined-change', bookingDate: '2026-11-27', status: 'declined', replacesBookingId: 'booking' })
    seed({ id: 'diner-cancel', bookingDate: '2026-11-05', status: 'cancelled', cancelledBy: 'diner_ai' })
    const { stats } = (await get()).bookingHistory
    expect(stats).toMatchObject({ total: 2, confirmed: 1, cancelled: 1, pending: 0, declined: 0 })
  })

  it('a declined-only history has no lastBookingDate (nor a cancelled or pending one)', async () => {
    seed({ bookingDate: '2026-11-01', status: 'declined' })
    seed({ bookingDate: '2026-11-02', status: 'cancelled', cancelledBy: 'diner_ai' })
    seed({ bookingDate: '2026-11-03', status: 'pending' })
    const { stats } = (await get()).bookingHistory
    expect(stats.lastBookingDate).toBeNull()
    expect(stats.total).toBe(3)
  })

  it('a member with no bookings → empty list and zero stats', async () => {
    expect((await get()).bookingHistory).toEqual({
      bookings: [],
      stats: { total: 0, confirmed: 0, cancelled: 0, declined: 0, noShow: 0, pending: 0, lastBookingDate: null, nextBookingDate: null },
    })
  })

  it('a failed read → 200 with bookingHistory null; the rest of the member still loads', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    world.reader.fail = true
    const res = await GET(new NextRequest(`http://localhost/api/dashboard/members?id=${MEMBER}`))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.bookingHistory).toBeNull()
    expect(json.phone).toBe(detail.phone)
  })

  it('a member that 404s leaks no bookings', async () => {
    seed()
    vi.mocked(getMemberDetailForRestaurant).mockResolvedValue(null)
    const res = await GET(new NextRequest(`http://localhost/api/dashboard/members?id=${MEMBER}`))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Member not found' })
  })

  it('a non-UUID member id never reaches the bookings read', async () => {
    vi.mocked(getMemberDetailForRestaurant).mockResolvedValue(null)
    await GET(new NextRequest('http://localhost/api/dashboard/members?id=not-a-uuid'))
    expect(world.reader.calls).toEqual([])
  })
})

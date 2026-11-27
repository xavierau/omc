// BOOK-008 (R1, R2, R4, R8): the SHAPE of the booking ↔ member queries. Every
// read and write is scoped by restaurant in the query; the member list is
// scoped by member too, excludes unverified, newest first and capped; the
// relink and stats are the 088 RPCs. SQL semantics: AC-6 scratch-DB log.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { recordingSupabase, filtersOf } from '@/test-utils/recording-supabase'

vi.mock('@/infrastructure/supabase/client', () => ({ createServerSupabaseClient: vi.fn() }))

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import {
  bookingMemberLinkStore,
  listMemberBookings,
  memberBookingStats,
  memberExistsForRestaurant,
  relinkBookingMember,
} from '../booking-member-repository'
import { linkAgentBookingMember } from '../agent-booking-repository'
import { findMemberIdByPhoneStrict } from '../member-repository'
import { STAFF_COLUMNS } from '../booking-request-repository'

function use(results: Parameters<typeof recordingSupabase>[0]) {
  const rec = recordingSupabase(results)
  vi.mocked(createServerSupabaseClient).mockReturnValue(rec.client as never)
  return rec
}

const ROW = {
  id: 'b-1', restaurant_id: 'r-a', member_id: 'm-2', phone: '+85290000001', name: 'Test Diner', party_size: 4,
  booking_date: '2026-11-19', booking_time: '19:30:00', notes: null, status: 'confirmed', decline_reason: null,
  decided_by: 'u', decided_at: '2026-11-18T00:00:00Z', source: 'chat', campaign_id: null, created_at: '2026-11-18T00:00:00Z',
  decision_message_status: 'delivered', replaces_booking_id: null, cancelled_by: null,
}

beforeEach(() => vi.clearAllMocks())

describe('member bookings list and stats (R8, R2)', () => {
  it('list: scoped by restaurant AND member, unverified excluded, newest date then time, capped', async () => {
    const rec = use([{ data: [{ id: 'b-1', booking_date: '2026-11-19', booking_time: '19:30:00', party_size: 4, status: 'no_show' }] }])
    const rows = await listMemberBookings('m-1', 'r-a', 50)
    const q = rec.queries[0]
    expect(q.table).toBe('booking_requests')
    expect(q.calls[0]).toEqual(['select', 'id, booking_date, booking_time, party_size, status'])
    expect(filtersOf(q)).toEqual(['eq:restaurant_id=r-a', 'eq:member_id=m-1', 'not:status.in=(unverified,awaiting_deposit,lapsed)'])
    expect(q.calls.filter(([m]) => m === 'order')).toEqual([
      ['order', 'booking_date', { ascending: false }],
      ['order', 'booking_time', { ascending: false }],
    ])
    expect(q.calls.at(-1)).toEqual(['limit', 50])
    expect(rows).toEqual([{ id: 'b-1', bookingDate: '2026-11-19', bookingTime: '19:30', partySize: 4, status: 'no_show' }])
  })

  it('stats: one RPC with member, restaurant and the Hong Kong now; mapped to camelCase', async () => {
    const rec = use([{ data: [{ total: 3, confirmed: 1, cancelled: 0, declined: 0, no_show: 1, pending: 1, last_booking_date: '2026-11-19', next_booking_date: '2026-11-25' }] }])
    const stats = await memberBookingStats('m-1', 'r-a', { date: '2026-11-20', time: '11:00' })
    expect(rec.queries).toHaveLength(1)
    expect(rec.queries[0].table).toBe('rpc:member_booking_stats')
    expect(rec.queries[0].calls[0]).toEqual(['rpc', { p_member_id: 'm-1', p_restaurant_id: 'r-a', p_now_date: '2026-11-20', p_now_time: '11:00' }])
    expect(stats).toEqual({ total: 3, confirmed: 1, cancelled: 0, declined: 0, noShow: 1, pending: 1, arrived: 0, lastBookingDate: '2026-11-19', nextBookingDate: '2026-11-25' })
  })

  it('BOOK-013 (AC-23): the 095 stats carry arrived', async () => {
    use([{ data: [{ total: 3, confirmed: 2, cancelled: 0, declined: 0, no_show: 0, pending: 1, arrived: 2, last_booking_date: null, next_booking_date: null }] }])
    expect((await memberBookingStats('m-1', 'r-a', { date: '2026-11-20', time: '11:00' })).arrived).toBe(2)
  })

  it('stats: an RPC error throws (the use case answers null), never zero counts', async () => {
    use([{ error: { message: 'function does not exist' } }])
    await expect(memberBookingStats('m-1', 'r-a', { date: '2026-11-20', time: '11:00' })).rejects.toThrow('memberBookingStats')
  })
})

describe('relink and member lookup (R2, R4)', () => {
  it('relink: one RPC call with booking, restaurant, from, to and actor, returning the staff columns', async () => {
    const rec = use([{ data: [ROW] }])
    const booking = await relinkBookingMember({ id: 'b-1', restaurantId: 'r-a', fromMemberId: 'm-1', toMemberId: 'm-2', actorUserId: 'u-1' })
    expect(rec.queries).toHaveLength(1)
    const q = rec.queries[0]
    expect(q.table).toBe('rpc:relink_booking_member')
    expect(q.calls[0]).toEqual([
      'rpc',
      { p_id: 'b-1', p_restaurant_id: 'r-a', p_from_member_id: 'm-1', p_to_member_id: 'm-2', p_actor_user_id: 'u-1' },
    ])
    expect(String(q.calls[1][1])).toContain('replaces_booking_id')
    expect(booking).toMatchObject({ id: 'b-1', memberId: 'm-2', bookingTime: '19:30' })
  })

  it('relink: no row changed → null', async () => {
    use([{ data: [] }])
    expect(await relinkBookingMember({ id: 'b-1', restaurantId: 'r-a', fromMemberId: null, toMemberId: 'm-2', actorUserId: 'u' })).toBeNull()
  })

  it('member lookup: scoped by id AND restaurant; a malformed id is a miss, other errors throw', async () => {
    const rec = use([{ data: { id: 'm-1' } }])
    expect(await memberExistsForRestaurant('m-1', 'r-a')).toBe(true)
    expect(filtersOf(rec.queries[0])).toEqual(['eq:id=m-1', 'eq:restaurant_id=r-a'])
    use([{ data: null }])
    expect(await memberExistsForRestaurant('m-1', 'r-b')).toBe(false)
    use([{ error: { message: 'invalid input syntax for type uuid', code: '22P02' } as never }])
    expect(await memberExistsForRestaurant('nope', 'r-a')).toBe(false)
    use([{ error: { message: 'timeout', code: '57014' } as never }])
    await expect(memberExistsForRestaurant('m-1', 'r-a')).rejects.toThrow()
  })
})

describe('poppy verification link (R1)', () => {
  it('one UPDATE of member_id only, scoped by id AND restaurant, while unlinked and past unverified', async () => {
    const rec = use([{ data: [{ id: 'b-1' }] }])
    expect(await linkAgentBookingMember('b-1', 'r-a', 'm-1')).toBe(true)
    const q = rec.queries[0]
    expect(q.calls[0]).toEqual(['update', { member_id: 'm-1' }])
    expect(filtersOf(q)).toEqual(['eq:id=b-1', 'eq:restaurant_id=r-a', 'is:member_id=null', 'neq:status=unverified'])
    use([{ data: [] }])
    expect(await linkAgentBookingMember('b-1', 'r-a', 'm-1')).toBe(false)
  })
})

// r1 F6 (/code-review PR #214): a no-op PATCH answered the booking read with
// the BOOK-001 columns (no replaces_booking_id / cancelled_by), a change with
// the staff columns; both now read the staff columns.
describe('relink store booking read (r1 F6)', () => {
  it('reads the staff columns, scoped by id AND restaurant, never an unverified booking', async () => {
    const rec = use([{ data: { ...ROW, replaces_booking_id: 'b-0', cancelled_by: null } }])
    const booking = await bookingMemberLinkStore.findBooking('b-1', 'r-a')
    const q = rec.queries[0]
    expect(q.table).toBe('booking_requests')
    expect(q.calls[0]).toEqual(['select', STAFF_COLUMNS])
    expect(filtersOf(q)).toEqual(['eq:id=b-1', 'eq:restaurant_id=r-a', 'not:status.in=(unverified,awaiting_deposit,lapsed)'])
    expect(q.calls.at(-1)).toEqual(['maybeSingle'])
    expect(booking).toMatchObject({ id: 'b-1', replacesBookingId: 'b-0', cancelledBy: null })
  })

  it('no row → null; a malformed id is a miss; other errors throw', async () => {
    use([{ data: null }])
    expect(await bookingMemberLinkStore.findBooking('b-1', 'r-b')).toBeNull()
    use([{ error: { message: 'invalid input syntax for type uuid', code: '22P02' } as never }])
    expect(await bookingMemberLinkStore.findBooking('nope', 'r-a')).toBeNull()
    use([{ error: { message: 'timeout', code: '57014' } as never }])
    await expect(bookingMemberLinkStore.findBooking('b-1', 'r-a')).rejects.toThrow('findStaffBooking')
  })
})

// r1 F7 (/code-review PR #214): findMemberByPhone answers null on a DB error,
// so the poppy promotion link failed silently. Its lookup now throws instead,
// and linkExistingMember logs the failure; findMemberByPhone is unchanged.
describe('poppy promotion member lookup (r1 F7)', () => {
  it('scoped by restaurant AND phone; no row → null; a member → its id', async () => {
    const rec = use([{ data: null }])
    expect(await findMemberIdByPhoneStrict('r-a', '+85290000001')).toBeNull()
    const q = rec.queries[0]
    expect(q.table).toBe('members')
    expect(q.calls[0]).toEqual(['select', 'id'])
    expect(filtersOf(q)).toEqual(['eq:restaurant_id=r-a', 'eq:phone=+85290000001'])
    expect(q.calls.at(-1)).toEqual(['maybeSingle'])
    use([{ data: { id: 'm-1' } }])
    expect(await findMemberIdByPhoneStrict('r-a', '+85290000001')).toBe('m-1')
  })

  it('a DB error throws (never reads as "no member")', async () => {
    use([{ error: { message: 'timeout', code: '57014' } as never }])
    await expect(findMemberIdByPhoneStrict('r-a', '+85290000001')).rejects.toThrow('findMemberIdByPhoneStrict')
  })
})

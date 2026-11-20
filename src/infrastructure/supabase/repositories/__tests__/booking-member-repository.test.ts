// BOOK-008 (R1, R2, R4, R8): the SHAPE of the booking ↔ member queries. Every
// read and write is scoped by restaurant in the query; the member list is
// scoped by member too, excludes unverified, newest first and capped; the
// relink and stats are the 088 RPCs. SQL semantics: AC-6 scratch-DB log.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { recordingSupabase, filtersOf } from '@/test-utils/recording-supabase'

vi.mock('@/infrastructure/supabase/client', () => ({ createServerSupabaseClient: vi.fn() }))

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import {
  listMemberBookings,
  memberBookingStats,
  memberExistsForRestaurant,
  relinkBookingMember,
} from '../booking-member-repository'
import { linkAgentBookingMember } from '../agent-booking-repository'

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
    expect(filtersOf(q)).toEqual(['eq:restaurant_id=r-a', 'eq:member_id=m-1', 'neq:status=unverified'])
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
    expect(stats).toEqual({ total: 3, confirmed: 1, cancelled: 0, declined: 0, noShow: 1, pending: 1, lastBookingDate: '2026-11-19', nextBookingDate: '2026-11-25' })
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

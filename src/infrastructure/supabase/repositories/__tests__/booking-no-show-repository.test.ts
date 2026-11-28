// BOOK-007 (R5, R6, R9): the SHAPE of the no-show queries. Mark and undo are
// one conditional statement each (mark: RPC, r1 F1), scoped by id AND restaurant; the
// staff lists' status allow-lists carry no_show; the purge has no status
// filter (so it clears no_show rows too); reminders and the diner/agent list
// only ever select their own statuses. SQL semantics: AC-4 scratch-DB log.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { recordingSupabase, filtersOf } from '@/test-utils/recording-supabase'

vi.mock('@/infrastructure/supabase/client', () => ({ createServerSupabaseClient: vi.fn() }))

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import {
  claimBookingReminder,
  listBookingRequests,
  listBookingRequestsInRange,
  listUpcomingDinerBookings,
  markBookingNoShow,
  purgeBookingPii,
  undoBookingNoShow,
} from '../booking-request-repository'

const ROW = {
  id: 'b-1', restaurant_id: 'r-a', member_id: null, phone: '+85290000001', name: 'Test Diner', party_size: 4,
  booking_date: '2026-11-19', booking_time: '19:30:00', notes: null, status: 'no_show', decline_reason: null,
  decided_by: 'u', decided_at: '2026-11-18T00:00:00Z', source: 'chat', campaign_id: null, created_at: '2026-11-18T00:00:00Z',
  decision_message_status: 'delivered', replaces_booking_id: null, cancelled_by: null,
}
const AT = new Date('2026-11-20T03:00:00.000Z')
const BEFORE = { date: '2026-11-20', time: '11:00' }

function use(results: Parameters<typeof recordingSupabase>[0]) {
  const rec = recordingSupabase(results)
  vi.mocked(createServerSupabaseClient).mockReturnValue(rec.client as never)
  return rec
}

beforeEach(() => vi.clearAllMocks())

describe('no-show mark / undo (R5, R6)', () => {
  // r1 F1: the mark is one statement in SQL (mark_booking_no_show, migration 087) so the "no open change" check
  // and the UPDATE cannot race; the SQL itself is pinned by booking-no-show-migration-contract.test.ts + AC-4.
  it('mark: one RPC call with id, restaurant, who, when and the Hong Kong now, returning the staff columns', async () => {
    const rec = use([{ data: [ROW] }])
    const booking = await markBookingNoShow({ id: 'b-1', restaurantId: 'r-a', markedBy: 'user-1', at: AT, before: BEFORE })
    expect(rec.queries).toHaveLength(1)
    const q = rec.queries[0]
    expect(q.table).toBe('rpc:mark_booking_no_show')
    expect(q.calls[0]).toEqual([
      'rpc',
      { p_id: 'b-1', p_restaurant_id: 'r-a', p_marked_by: 'user-1', p_marked_at: AT.toISOString(), p_before_date: '2026-11-20', p_before_time: '11:00' },
    ])
    expect(q.calls[1][0]).toBe('select')
    expect(String(q.calls[1][1])).toContain('replaces_booking_id')
    expect(booking).toMatchObject({ id: 'b-1', status: 'no_show', bookingTime: '19:30' })
  })

  it('mark: no row changed → null', async () => {
    use([{ data: [] }])
    expect(await markBookingNoShow({ id: 'b-1', restaurantId: 'r-a', markedBy: 'u', at: AT, before: BEFORE })).toBeNull()
  })

  it('undo: one UPDATE from no_show only, back to confirmed, clearing both marker columns', async () => {
    const rec = use([{ data: { ...ROW, status: 'confirmed' } }])
    const booking = await undoBookingNoShow({ id: 'b-1', restaurantId: 'r-a' })
    const q = rec.queries[0]
    expect(q.calls[0]).toEqual(['update', { status: 'confirmed', no_show_marked_by: null, no_show_marked_at: null }])
    expect(filtersOf(q)).toEqual(['eq:id=b-1', 'eq:restaurant_id=r-a', 'eq:status=no_show'])
    expect(booking?.status).toBe('confirmed')
  })

  it('surfaces a database error', async () => {
    use([{ error: { message: 'boom' } }])
    await expect(undoBookingNoShow({ id: 'b-1', restaurantId: 'r-a' })).rejects.toThrow('undoBookingNoShow: boom')
  })
})

describe('no_show in the other booking queries (R9, R7)', () => {
  it('the default list and the date-range list return no_show rows', async () => {
    const rec = use([{ data: [] }, { data: [ROW] }])
    const list = await listBookingRequests('r-a', 200)
    expect(filtersOf(rec.queries[1])).toEqual(['eq:restaurant_id=r-a', 'in:status=confirmed,declined,cancelled,no_show'])
    expect(list.map((b) => b.status)).toEqual(['no_show'])

    const range = use([{ data: [ROW] }])
    const result = await listBookingRequestsInRange('r-a', { from: '2026-11-01', to: '2026-11-30' }, 10)
    expect(filtersOf(range.queries[0])).toEqual(['eq:restaurant_id=r-a', 'or:status.in.(pending,confirmed,declined,cancelled,no_show),and(status.eq.awaiting_deposit,source.eq.staff)'])
    expect(result.bookings.map((b) => b.status)).toEqual(['no_show'])
  })

  it('the retention purge has no status filter, so no_show rows are purged like the rest', async () => {
    const rec = use([{ data: [{ id: 'b-1' }] }])
    await purgeBookingPii('2026-05-24', AT)
    expect(filtersOf(rec.queries[0])).toEqual(['lt:booking_date=2026-05-24', 'is:pii_purged_at=null'])
  })

  it('a reminder is only ever claimed on a confirmed row (candidates: status = confirmed in SQL, AC-4 log)', async () => {
    const rec = use([{ data: [] }])
    expect(await claimBookingReminder('b-1', AT)).toBe(false)
    expect(filtersOf(rec.queries[0])).toContain('eq:status=confirmed')
  })

  it("the diner/agent list (list_my_bookings) selects pending and confirmed only, so a no_show row never reaches the agent", async () => {
    const rec = use([{ data: [] }])
    await listUpcomingDinerBookings('r-a', '+85290000001', BEFORE)
    expect(filtersOf(rec.queries[0])).toContain('in:status=pending,confirmed')
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { recordingSupabase, filtersOf } from '@/test-utils/recording-supabase'

vi.mock('@/infrastructure/supabase/client', () => ({ createServerSupabaseClient: vi.fn() }))

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import {
  countPendingBookings,
  countRestaurantPendingBookings,
  decideBookingRequest,
  findBookingForRestaurant,
  insertBookingRequest,
  listBookingRequests,
  listBookingRequestsInRange,
  listPendingBookingRequests,
  recordDecisionMessage,
} from '../booking-request-repository'

const ROW = {
  id: 'b-1', restaurant_id: 'r-a', member_id: null, phone: '+852', name: 'Chan', party_size: 4,
  booking_date: '2026-11-13', booking_time: '19:30:00', notes: null, status: 'pending', decline_reason: null,
  decided_by: null, decided_at: null, source: 'chat', campaign_id: null, created_at: '2026-11-12T10:00:00Z',
  decision_message_status: null,
}

function use(results: Parameters<typeof recordingSupabase>[0]) {
  const rec = recordingSupabase(results)
  vi.mocked(createServerSupabaseClient).mockReturnValue(rec.client as never)
  return rec
}

beforeEach(() => vi.clearAllMocks())

describe('booking-request-repository (R4, R5, R6)', () => {
  it('scopes get by id AND restaurant inside the query', async () => {
    const rec = use([{ data: ROW }])
    const found = await findBookingForRestaurant('b-1', 'r-a')
    expect(filtersOf(rec.queries[0])).toEqual(['eq:id=b-1', 'eq:restaurant_id=r-a', 'neq:status=unverified'])
    expect(found?.bookingTime).toBe('19:30')
  })

  // F10 (review #8): every pending request, plus the newest decided ones, so
  // a busy restaurant never loses a pending request past the limit.
  it('lists every pending request plus the newest decided ones, one restaurant, merged newest first', async () => {
    const pendingOld = { ...ROW, id: 'p-old', created_at: '2026-11-01T00:00:00Z' }
    const decidedNew = { ...ROW, id: 'd-new', status: 'confirmed', decided_at: '2026-11-12T11:00:00Z', created_at: '2026-11-12T09:00:00Z' }
    const rec = use([{ data: [pendingOld] }, { data: [decidedNew] }])
    const list = await listBookingRequests('r-a', 200)
    expect(list.map((b) => b.id)).toEqual(['d-new', 'p-old'])
    const [pending, decided] = rec.queries
    expect(filtersOf(pending)).toEqual(['eq:restaurant_id=r-a', 'eq:status=pending'])
    expect(pending.calls.some(([m]) => m === 'limit')).toBe(false)
    expect(filtersOf(decided)).toEqual(['eq:restaurant_id=r-a', 'in:status=confirmed,declined,cancelled'])
    expect(decided.calls).toContainEqual(['limit', 200])
    for (const q of rec.queries) expect(q.calls).toContainEqual(['order', 'created_at', { ascending: false }])
  })

  // BOOK-004 R1-R4: one query, tenant + staff-visible + date window in SQL, one row past the cap.
  it('lists a date range scoped in the query, date then time ascending, reading cap + 1 to flag truncation', async () => {
    const rec = use([{ data: [ROW, { ...ROW, id: 'b-2' }, { ...ROW, id: 'b-3' }] }])
    const result = await listBookingRequestsInRange('r-a', { from: '2026-11-01', to: '2026-11-30' }, 2)
    const q = rec.queries[0]
    expect(filtersOf(q)).toEqual(['eq:restaurant_id=r-a', 'in:status=pending,confirmed,declined,cancelled'])
    expect(q.calls).toContainEqual(['gte', 'booking_date', '2026-11-01'])
    expect(q.calls).toContainEqual(['lte', 'booking_date', '2026-11-30'])
    expect(q.calls.filter(([m]) => m === 'order')).toEqual([
      ['order', 'booking_date', { ascending: true }],
      ['order', 'booking_time', { ascending: true }],
    ])
    expect(q.calls).toContainEqual(['limit', 3])
    expect(result.bookings.map((b) => b.id)).toEqual(['b-1', 'b-2'])
    expect(result.truncated).toBe(true)
  })

  // BOOK-004 r4 (owner 2026-11-19): cancelled bookings are shown like declined; unverified stays out (R2).
  // AGENT-003 (7af9494b): the new views carry the change/cancel columns and the replaced slot.
  const OLD_SLOT = { id: 'b-old', booking_date: '2026-11-12', booking_time: '19:00:00', party_size: 2 }
  const changeRow = { ...ROW, id: 'b-new', replaces_booking_id: 'b-old', cancelled_by: null }
  const cancelledRow = { ...ROW, id: 'b-gone', status: 'cancelled', replaces_booking_id: null, cancelled_by: 'diner_ai' }

  it('r4: the range list allow-lists cancelled (never unverified) and reads the AGENT-003 columns and replaced slots', async () => {
    const rec = use([{ data: [cancelledRow, changeRow] }, { data: [OLD_SLOT] }])
    const result = await listBookingRequestsInRange('r-a', { from: '2026-11-01', to: '2026-11-30' }, 10)
    const [q, slots] = rec.queries
    expect(filtersOf(q)).toEqual(['eq:restaurant_id=r-a', 'in:status=pending,confirmed,declined,cancelled'])
    expect(filtersOf(q).join()).not.toContain('unverified')
    expect(String(q.calls.find(([m]) => m === 'select')?.[1])).toContain('replaces_booking_id, cancelled_by')
    expect(filtersOf(slots)).toEqual(['eq:restaurant_id=r-a', 'in:id=b-old'])
    expect(result.bookings.find((b) => b.id === 'b-new')?.replaces).toEqual({ bookingDate: '2026-11-12', bookingTime: '19:00', partySize: 2 })
    expect(result.bookings.find((b) => b.id === 'b-gone')?.cancelledBy).toBe('diner_ai')
    expect(result.truncated).toBe(false)
  })

  it('r4: the all-pending list reads the AGENT-003 columns and the replaced slot, scoped by restaurant', async () => {
    const rec = use([{ data: [changeRow] }, { data: [OLD_SLOT] }])
    const result = await listPendingBookingRequests('r-a', 10)
    const [q, slots] = rec.queries
    expect(filtersOf(q)).toEqual(['eq:restaurant_id=r-a', 'eq:status=pending'])
    expect(String(q.calls.find(([m]) => m === 'select')?.[1])).toContain('replaces_booking_id, cancelled_by')
    expect(filtersOf(slots)).toEqual(['eq:restaurant_id=r-a', 'in:id=b-old'])
    expect(result.bookings[0].replaces).toEqual({ bookingDate: '2026-11-12', bookingTime: '19:00', partySize: 2 })
  })

  // BOOK-006 changed this from "exactly one query": the open-change read runs for any listed pending/confirmed row.
  it('r4: a range with no change request makes no replaced-slot read', async () => {
    const rec = use([{ data: [ROW] }])
    await listBookingRequestsInRange('r-a', { from: '2026-11-01', to: '2026-11-30' }, 10)
    expect(rec.queries.some((q) => filtersOf(q).some((f) => f.startsWith('in:id=')))).toBe(false)
  })

  // BOOK-006: an original with an open (pending) change carries that change's slot, found by
  // replaces_booking_id in one tenant-scoped read of the pending rows, not in the returned page.
  const PENDING_CHANGE = { id: 'b-chg', replaces_booking_id: 'b-1', booking_date: '2026-12-24', booking_time: '18:30:00', party_size: 6 }
  const PENDING_PLAIN = { id: 'b-9', replaces_booking_id: null, booking_date: '2026-11-14', booking_time: '12:00:00', party_size: 2 }

  it('BOOK-006: the range list marks an original whose change is dated outside the range', async () => {
    const rec = use([{ data: [ROW, { ...ROW, id: 'b-2', status: 'confirmed' }] }, { data: [PENDING_PLAIN, PENDING_CHANGE] }])
    const result = await listBookingRequestsInRange('r-a', { from: '2026-11-01', to: '2026-11-30' }, 10)
    expect(rec.queries).toHaveLength(2)
    const open = rec.queries[1]
    expect(filtersOf(open)).toEqual(['eq:restaurant_id=r-a', 'eq:status=pending'])
    expect(String(open.calls.find(([m]) => m === 'select')?.[1])).toContain('replaces_booking_id')
    expect(result.bookings.find((b) => b.id === 'b-1')?.openChange).toEqual({ id: 'b-chg', bookingDate: '2026-12-24', bookingTime: '18:30', partySize: 6 })
    expect(result.bookings.find((b) => b.id === 'b-2')?.openChange).toBeUndefined()
  })

  it('BOOK-006: a confirmed original is marked too; the pending and default lists attach open changes', async () => {
    const confirmed = { ...ROW, status: 'confirmed' }
    use([{ data: [confirmed] }, { data: [PENDING_CHANGE] }])
    expect((await listBookingRequestsInRange('r-a', { from: '2026-11-01', to: '2026-11-30' }, 10)).bookings[0].openChange?.id).toBe('b-chg')
    use([{ data: [ROW] }, { data: [PENDING_CHANGE] }])
    expect((await listPendingBookingRequests('r-a', 10)).bookings[0].openChange?.id).toBe('b-chg')
    const rec = use([{ data: [ROW] }, { data: [confirmed] }, { data: [PENDING_CHANGE] }])
    const list = await listBookingRequests('r-a', 200)
    expect(list.every((b) => b.openChange?.id === 'b-chg')).toBe(true)
    expect(filtersOf(rec.queries[2])).toEqual(['eq:restaurant_id=r-a', 'eq:status=pending'])
  })

  it('BOOK-006: a list of only decided rows makes no open-change read', async () => {
    const rec = use([{ data: [{ ...ROW, status: 'declined' }] }])
    const result = await listBookingRequestsInRange('r-a', { from: '2026-11-01', to: '2026-11-30' }, 10)
    expect(rec.queries).toHaveLength(1)
    expect(result.bookings[0].openChange).toBeUndefined()
  })

  it('BOOK-006: pendingCount counts an open pair once; the open-change read is tenant-scoped', async () => {
    const orig = { ...PENDING_PLAIN, id: 'b-1' }
    const rec = use([{ count: 2 }, { data: [orig, PENDING_CHANGE] }])
    expect(await countRestaurantPendingBookings('r-a')).toBe(1)
    expect(filtersOf(rec.queries[0])).toEqual(['eq:restaurant_id=r-a', 'eq:status=pending'])
    expect(filtersOf(rec.queries[1])).toEqual(['eq:restaurant_id=r-a', 'eq:status=pending'])
  })

  it('BOOK-006: two unrelated pending rows count 2; a confirmed original + its pending change count 1', async () => {
    use([{ count: 2 }, { data: [PENDING_PLAIN, { ...PENDING_PLAIN, id: 'b-8' }] }])
    expect(await countRestaurantPendingBookings('r-a')).toBe(2)
    use([{ count: 1 }, { data: [PENDING_CHANGE] }])
    expect(await countRestaurantPendingBookings('r-a')).toBe(1)
  })

  it('counts every pending request of a restaurant', async () => {
    const rec = use([{ count: 4 }])
    expect(await countRestaurantPendingBookings('r-a')).toBe(4)
    expect(filtersOf(rec.queries[0])).toEqual(['eq:restaurant_id=r-a', 'eq:status=pending'])
  })

  // F9 (review #7): the decision message outcome is stored, scoped by restaurant.
  it('records whether the decision message was delivered, scoped by id and restaurant', async () => {
    const rec = use([{ error: null }])
    await recordDecisionMessage('b-1', 'r-a', 'not_delivered')
    expect(rec.queries[0].calls[0]).toEqual(['update', { decision_message_status: 'not_delivered' }])
    expect(filtersOf(rec.queries[0])).toEqual(['eq:id=b-1', 'eq:restaurant_id=r-a'])
  })

  it('maps the stored decision message status', async () => {
    use([{ data: { ...ROW, status: 'confirmed', decided_at: 'x', decision_message_status: 'not_delivered' } }])
    expect((await findBookingForRestaurant('b-1', 'r-a'))?.decisionMessageStatus).toBe('not_delivered')
  })

  it('decides with a conditional update on pending, storing who and when', async () => {
    const rec = use([{ data: { ...ROW, status: 'declined' } }])
    const at = new Date('2026-11-12T11:00:00.000Z')
    await decideBookingRequest({
      id: 'b-1', restaurantId: 'r-a', decision: 'declined', decidedBy: 'u-1', decidedAt: at, declineReason: 'Full',
    })
    expect(rec.queries[0].calls[0]).toEqual([
      'update',
      { status: 'declined', decided_by: 'u-1', decided_at: at.toISOString(), decline_reason: 'Full' },
    ])
    expect(filtersOf(rec.queries[0])).toEqual(['eq:id=b-1', 'eq:restaurant_id=r-a', 'eq:status=pending'])
  })

  it('returns null when the conditional update changed nothing', async () => {
    use([{ data: null }])
    const result = await decideBookingRequest({
      id: 'b-1', restaurantId: 'r-a', decision: 'confirmed', decidedBy: 'u', decidedAt: new Date(), declineReason: 'x',
    })
    expect(result).toBeNull()
  })

  it('counts pending per phone per restaurant', async () => {
    const rec = use([{ count: 3 }])
    expect(await countPendingBookings('r-a', '+852')).toBe(3)
    expect(filtersOf(rec.queries[0])).toEqual(['eq:restaurant_id=r-a', 'eq:phone=+852', 'eq:status=pending'])
    // BOOK-006: the diner-side rate limit counts every pending row, pairs included (unchanged, one query).
    expect(rec.queries).toHaveLength(1)
  })

  it('inserts with the token so the database enforces one booking per link', async () => {
    const rec = use([{ data: ROW }])
    await insertBookingRequest({
      restaurantId: 'r-a', memberId: null, phone: '+852', name: 'Chan', partySize: 4, bookingDate: '2026-11-13',
      bookingTime: '19:30', notes: null, source: 'chat', campaignId: null, token: 'tok',
    })
    expect((rec.queries[0].calls[0][1] as Record<string, unknown>).token).toBe('tok')
  })
})

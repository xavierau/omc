import { describe, it, expect, vi, beforeEach } from 'vitest'
import { recordingSupabase, filtersOf } from '@/test-utils/recording-supabase'

vi.mock('@/infrastructure/supabase/client', () => ({ createServerSupabaseClient: vi.fn() }))

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import {
  countPendingBookings,
  decideBookingRequest,
  findBookingForRestaurant,
  insertBookingRequest,
  listBookingRequests,
} from '../booking-request-repository'

const ROW = {
  id: 'b-1', restaurant_id: 'r-a', member_id: null, phone: '+852', name: 'Chan', party_size: 4,
  booking_date: '2026-11-13', booking_time: '19:30:00', notes: null, status: 'pending', decline_reason: null,
  decided_by: null, decided_at: null, source: 'chat', campaign_id: null, created_at: '2026-11-12T10:00:00Z',
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
    expect(filtersOf(rec.queries[0])).toEqual(['eq:id=b-1', 'eq:restaurant_id=r-a'])
    expect(found?.bookingTime).toBe('19:30')
  })

  it('lists one restaurant, newest first, with a limit', async () => {
    const rec = use([{ data: [ROW] }])
    await listBookingRequests('r-a', 200)
    expect(filtersOf(rec.queries[0])).toEqual(['eq:restaurant_id=r-a'])
    expect(rec.queries[0].calls).toContainEqual(['order', 'created_at', { ascending: false }])
    expect(rec.queries[0].calls).toContainEqual(['limit', 200])
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

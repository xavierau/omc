// BOOK-014 W6a: the lapse hook's booking read. Agent bookings only, by id in
// chunks (PostgREST echoes the filter in a response header, so the id list
// stays short), every row checked against the deposit's own restaurant; the
// status token hash is read only to tell a personal agent booking apart and
// never leaves the adapter.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { recordingSupabase, filtersOf } from '@/test-utils/recording-supabase'

vi.mock('@/infrastructure/supabase/client', () => ({ createServerSupabaseClient: vi.fn() }))

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { LAPSED_HOLD_CHUNK, lapsedHoldBookingReader } from '../lapsed-hold-booking-repository'

function use(results: Parameters<typeof recordingSupabase>[0]) {
  const rec = recordingSupabase(results)
  vi.mocked(createServerSupabaseClient).mockReturnValue(rec.client as never)
  return rec
}

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id, restaurant_id: 'rest-a', phone: '+85291234567', source: 'agent', status_token_hash: null,
  booking_date: '2026-12-24', booking_time: '19:00:00', party_size: 4, ...over,
})

beforeEach(() => vi.mocked(createServerSupabaseClient).mockReset())

describe('lapsedHoldBookingReader.findForDeposits', () => {
  it('no refs -> no query', async () => {
    const rec = use([])
    expect(await lapsedHoldBookingReader.findForDeposits([])).toEqual([])
    expect(rec.queries).toEqual([])
  })

  it('agent bookings by id; maps personalAgent from the status token, time as HH:MM; the hash is not returned', async () => {
    const rec = use([{ data: [row('b1'), row('b2', { status_token_hash: 'a'.repeat(64) })] }])
    const out = await lapsedHoldBookingReader.findForDeposits([
      { restaurantId: 'rest-a', bookingId: 'b1' },
      { restaurantId: 'rest-a', bookingId: 'b2' },
    ])
    expect(rec.queries[0].table).toBe('booking_requests')
    expect(filtersOf(rec.queries[0]).sort()).toEqual(['eq:source=agent', 'in:id=b1,b2'])
    expect(out).toEqual([
      { id: 'b1', restaurantId: 'rest-a', phone: '+85291234567', source: 'agent', personalAgent: false, bookingDate: '2026-12-24', bookingTime: '19:00', partySize: 4 },
      { id: 'b2', restaurantId: 'rest-a', phone: '+85291234567', source: 'agent', personalAgent: true, bookingDate: '2026-12-24', bookingTime: '19:00', partySize: 4 },
    ])
    expect(JSON.stringify(out)).not.toContain('aaaa')
  })

  it('a row whose restaurant is not the deposit restaurant is dropped', async () => {
    use([{ data: [row('b1', { restaurant_id: 'rest-b' })] }])
    expect(await lapsedHoldBookingReader.findForDeposits([{ restaurantId: 'rest-a', bookingId: 'b1' }])).toEqual([])
  })

  it(`more than ${LAPSED_HOLD_CHUNK} refs -> one query per chunk`, async () => {
    const rec = use(() => ({ data: [] }))
    const refs = Array.from({ length: LAPSED_HOLD_CHUNK * 2 + 1 }, (_, i) => ({ restaurantId: 'rest-a', bookingId: `b${i}` }))
    await lapsedHoldBookingReader.findForDeposits(refs)
    expect(rec.queries).toHaveLength(3)
  })

  it('an error throws (the hook logs it)', async () => {
    use([{ error: { message: 'boom' } }])
    await expect(lapsedHoldBookingReader.findForDeposits([{ restaurantId: 'rest-a', bookingId: 'b1' }])).rejects.toThrow('findLapsedHoldBookings')
  })
})

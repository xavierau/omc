// BOOK-014 W3 r1 (threat R62): the /p page's booking read. Only the slot
// columns (date, time, party), scoped by booking id AND restaurant id; never
// the diner's name, phone or notes.
// W6a: plus the booking status, so a cancelled / no-show booking whose paid
// deposit awaits the staff decision reads "held", not "request sent".
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { recordingSupabase, filtersOf } from '@/test-utils/recording-supabase'

vi.mock('@/infrastructure/supabase/client', () => ({ createServerSupabaseClient: vi.fn() }))

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { PAYMENT_LINK_DETAIL_COLUMNS, paymentLinkDetailsReader } from '../payment-link-details-repository'

const REF = { restaurantId: 'rest-a', bookingId: 'book-1' }

function use(results: Parameters<typeof recordingSupabase>[0]) {
  const rec = recordingSupabase(results)
  vi.mocked(createServerSupabaseClient).mockReturnValue(rec.client as never)
  return rec
}

beforeEach(() => vi.mocked(createServerSupabaseClient).mockReset())

describe('paymentLinkDetailsReader.findForDeposit', () => {
  it('selects only booking_date, booking_time, party_size, status; no name, phone or notes (R62)', async () => {
    const rec = use([{ data: { booking_date: '2026-12-24', booking_time: '19:00:00', party_size: 4, status: 'pending' } }])
    await paymentLinkDetailsReader.findForDeposit(REF)
    const select = rec.queries[0].calls.find(([m]) => m === 'select')?.[1] as string
    expect(select.split(',').map((c) => c.trim()).sort()).toEqual(['booking_date', 'booking_time', 'party_size', 'status'])
    expect(PAYMENT_LINK_DETAIL_COLUMNS).toBe(select)
    const columns = select.split(',').map((c) => c.trim())
    for (const pii of ['name', 'phone', 'notes', 'member_id', '*']) expect(columns).not.toContain(pii)
  })

  it('scoped by booking id AND restaurant id', async () => {
    const rec = use([{ data: null }])
    await paymentLinkDetailsReader.findForDeposit(REF)
    expect(rec.queries[0].table).toBe('booking_requests')
    expect(filtersOf(rec.queries[0]).sort()).toEqual(['eq:id=book-1', 'eq:restaurant_id=rest-a'])
  })

  it('maps the row; the time as HH:MM', async () => {
    use([{ data: { booking_date: '2026-12-24', booking_time: '19:00:00', party_size: 4, status: 'cancelled' } }])
    expect(await paymentLinkDetailsReader.findForDeposit(REF)).toEqual({ bookingDate: '2026-12-24', bookingTime: '19:00', partySize: 4, bookingStatus: 'cancelled' })
  })

  it('no row -> null; a not-a-uuid id (22P02) -> null; any other error throws', async () => {
    use([{ data: null }])
    expect(await paymentLinkDetailsReader.findForDeposit(REF)).toBeNull()
    use([{ error: { message: 'invalid input syntax', code: '22P02' } as never }])
    expect(await paymentLinkDetailsReader.findForDeposit(REF)).toBeNull()
    use([{ error: { message: 'boom' } }])
    await expect(paymentLinkDetailsReader.findForDeposit(REF)).rejects.toThrow('findPaymentLinkDetails')
  })
})

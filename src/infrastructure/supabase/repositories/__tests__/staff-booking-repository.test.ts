// BOOK-013 (R2, R3, R8, R9, R11, R12, R16): the SHAPE of the staff booking
// queries: every read is scoped by restaurant in the query, every write is
// the 095 RPC with the restaurant and the conditions as arguments, and the
// confirm writes the check-in code. SQL semantics: scratch-db-095.log.
import { describe, it, expect, vi } from 'vitest'
import { recordingSupabase, filtersOf } from '@/test-utils/recording-supabase'

vi.mock('@/infrastructure/supabase/client', () => ({ createServerSupabaseClient: vi.fn() }))

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { checkinStore, staffBookingStore } from '../staff-booking-repository'
import { decideBookingRequest, STAFF_COLUMNS } from '../booking-request-repository'

function use(results: Parameters<typeof recordingSupabase>[0]) {
  const rec = recordingSupabase(results)
  vi.mocked(createServerSupabaseClient).mockReturnValue(rec.client as never)
  return rec
}

const ROW = {
  id: 'b-1', restaurant_id: 'r-a', member_id: null, phone: '+85291234567', name: 'Chan', party_size: 2, booking_date: '2026-11-28',
  booking_time: '19:00:00', notes: null, status: 'confirmed', decline_reason: null, decided_by: 'u', decided_at: null, source: 'staff',
  campaign_id: null, created_at: '2026-11-26T00:00:00Z', decision_message_status: null, replaces_booking_id: null, cancelled_by: null,
  terms_accepted_at: null, terms_text: null, updated_at: '2026-11-26T01:02:03.456789+00:00', created_by: 'u', notify_diner: false,
  checkin_code: 'K7Q2MX', checked_in_at: null,
}
const AT = new Date('2026-11-26T03:00:00Z')
const input = { phone: '+85291234567', name: 'Chan', partySize: 2, date: '2026-11-28', time: '19:00', notes: null, notify: false, override: false }

describe('staff booking repository (095)', () => {
  it('STAFF_COLUMNS carries the 095 columns; the mapper reads them', async () => {
    for (const c of ['updated_at', 'created_by', 'notify_diner', 'checkin_code', 'checked_in_at']) expect(STAFF_COLUMNS).toContain(c)
    expect(STAFF_COLUMNS).not.toContain('checkin_qr_path')
    use([{ data: [ROW] }])
    const b = await staffBookingStore.create({ restaurantId: 'r-a', memberId: null, input, actorUserId: 'u', at: AT, codes: ['K7Q2MX'], brokenRules: [] })
    expect(b).toMatchObject({ updatedAt: ROW.updated_at, createdBy: 'u', notifyDiner: false, checkinCode: 'K7Q2MX', checkedInAt: null })
  })

  it('create calls staff_create_booking with the session restaurant, codes and broken rule codes', async () => {
    const rec = use([{ data: [ROW] }])
    await staffBookingStore.create({ restaurantId: 'r-a', memberId: 'm-1', input, actorUserId: 'u', at: AT, codes: ['K7Q2MX', 'H4PN8R'], brokenRules: ['outside_hours'] })
    expect(rec.queries[0].table).toBe('rpc:staff_create_booking')
    expect(rec.queries[0].calls[0][1]).toMatchObject({ p_restaurant_id: 'r-a', p_member_id: 'm-1', p_notify: false, p_codes: ['K7Q2MX', 'H4PN8R'], p_broken_rules: ['outside_hours'], p_actor: 'u' })
  })

  it('R3: edit passes the loaded status and updated_at verbatim; no row = nothing changed', async () => {
    const rec = use([{ data: [] }])
    const updated = await staffBookingStore.update({
      id: 'b-1', restaurantId: 'r-a', expectedStatus: 'confirmed', expectedUpdatedAt: ROW.updated_at, memberId: null, input,
      clearReminder: true, actorUserId: 'u', changed: ['time'], brokenRules: [],
    })
    expect(updated).toBeNull()
    expect(rec.queries[0].calls[0][1]).toMatchObject({ p_id: 'b-1', p_restaurant_id: 'r-a', p_expected_status: 'confirmed', p_expected_updated_at: ROW.updated_at, p_clear_reminder: true, p_changed: ['time'] })
  })

  it('cancel and check-in are the 095 RPCs scoped by restaurant', async () => {
    const rec = use([{ data: [] }, { data: [] }, { data: [] }])
    await staffBookingStore.cancel({ id: 'b-1', restaurantId: 'r-a', expectedUpdatedAt: ROW.updated_at, actorUserId: 'u', at: AT })
    await checkinStore.checkIn({ id: 'b-1', restaurantId: 'r-a', today: '2026-11-26', actorUserId: 'u', at: AT })
    await checkinStore.undoCheckIn({ id: 'b-1', restaurantId: 'r-a', actorUserId: 'u' })
    expect(rec.queries.map((q) => q.table)).toEqual(['rpc:staff_cancel_booking', 'rpc:booking_check_in', 'rpc:booking_check_in_undo'])
    expect(rec.queries.every((q) => (q.calls[0][1] as { p_restaurant_id: string }).p_restaurant_id === 'r-a')).toBe(true)
  })

  it('R11: the staff message claim is one conditional UPDATE (none in the last 5 minutes)', async () => {
    const rec = use([{ data: [{ id: 'b-1' }] }, { data: [] }])
    expect(await staffBookingStore.claimStaffMessage('b-1', 'r-a', AT, 300_000)).toBe(true)
    expect(await staffBookingStore.claimStaffMessage('b-1', 'r-a', AT, 300_000)).toBe(false)
    expect(rec.queries[0].calls[0]).toEqual(['update', { last_staff_message_at: AT.toISOString() }])
    expect(filtersOf(rec.queries[0])).toEqual(['eq:id=b-1', 'eq:restaurant_id=r-a', 'or:last_staff_message_at.is.null,last_staff_message_at.lt.2026-11-26T02:55:00.000Z'])
  })

  it('R12 / R2: today and by-code read only this restaurant\'s live rows', async () => {
    const rec = use((q) => (q.calls.some((c) => c[0] === 'limit') ? { data: [ROW, ROW] } : { data: null }))
    expect((await checkinStore.listForDate('r-a', '2026-11-26', 1)).truncated).toBe(true)
    await checkinStore.findByCode('r-a', 'K7Q2MX')
    expect(filtersOf(rec.queries[0])).toEqual(['eq:restaurant_id=r-a', 'eq:booking_date=2026-11-26', 'in:status=pending,confirmed,no_show'])
    expect(rec.queries[0].calls).toContainEqual(['limit', 2])
    const byCode = rec.queries.find((q) => filtersOf(q).includes('eq:checkin_code=K7Q2MX'))
    expect(filtersOf(byCode!)).toEqual(['eq:restaurant_id=r-a', 'eq:checkin_code=K7Q2MX', 'in:status=confirmed,no_show'])
  })

  it('R8: a confirm writes the code in the same UPDATE and tries the next on a code clash', async () => {
    const clash = { code: '23505', message: 'duplicate key value violates unique constraint "booking_requests_restaurant_checkin_code_idx" (checkin_code)' }
    const rec = use([{ error: clash }, { data: ROW }])
    await decideBookingRequest({ id: 'b-1', restaurantId: 'r-a', decision: 'confirmed', decidedBy: 'u', decidedAt: AT, declineReason: null, checkinCodes: ['AAAAA2', 'K7Q2MX'] })
    expect(rec.queries[0].calls[0][1]).toMatchObject({ status: 'confirmed', checkin_code: 'AAAAA2' })
    expect(rec.queries[1].calls[0][1]).toMatchObject({ checkin_code: 'K7Q2MX' })
    expect(filtersOf(rec.queries[1])).toEqual(['eq:id=b-1', 'eq:restaurant_id=r-a', 'eq:status=pending'])
  })

  it('a decline writes no code', async () => {
    const rec = use([{ data: { ...ROW, status: 'declined' } }])
    await decideBookingRequest({ id: 'b-1', restaurantId: 'r-a', decision: 'declined', decidedBy: 'u', decidedAt: AT, declineReason: 'x', checkinCodes: ['K7Q2MX'] })
    expect(rec.queries[0].calls[0][1]).not.toHaveProperty('checkin_code')
  })
})

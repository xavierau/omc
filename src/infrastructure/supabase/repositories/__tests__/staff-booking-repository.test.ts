// BOOK-013 (R2, R3, R9, R11, R12): the SHAPE of the staff booking queries:
// every read is scoped by restaurant in the query, and every write is the 095
// RPC with the restaurant and the conditions as arguments. SQL semantics:
// .claude-workspace/artifacts/evidence/2026-11-26-book-013-r3/scratch-db-095.log.
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
  terms_accepted_at: null, terms_text: null, edit_version: 7, created_by: 'u', notify_diner: false,
  checked_in_at: null,
}
const AT = new Date('2026-11-26T03:00:00Z')
const input = { phone: '+85291234567', name: 'Chan', partySize: 2, date: '2026-11-28', time: '19:00', notes: null, notify: false, override: false }

describe('staff booking repository (095)', () => {
  it('STAFF_COLUMNS carries the 095 columns; the mapper reads them', async () => {
    for (const c of ['edit_version', 'created_by', 'notify_diner', 'checked_in_at']) expect(STAFF_COLUMNS).toContain(c)
    // review R1: updated_at moves on background writes, so it is never the staff form's version.
    expect(STAFF_COLUMNS).not.toContain('updated_at')
    // spec decision 8: no check-in code or QR column is read.
    expect(STAFF_COLUMNS).not.toMatch(/checkin_/)
    use([{ data: [ROW] }])
    const b = await staffBookingStore.create({ restaurantId: 'r-a', memberId: null, input, actorUserId: 'u', at: AT, brokenRules: [] })
    expect(b).toMatchObject({ editVersion: 7, createdBy: 'u', notifyDiner: false, checkedInAt: null })
    expect(Object.keys(b).filter((k) => /checkin/i.test(k))).toEqual([])
  })

  it('create calls staff_create_booking with the session restaurant and broken rule codes (no code list)', async () => {
    const rec = use([{ data: [ROW] }])
    await staffBookingStore.create({ restaurantId: 'r-a', memberId: 'm-1', input, actorUserId: 'u', at: AT, brokenRules: ['outside_hours'] })
    expect(rec.queries[0].table).toBe('rpc:staff_create_booking')
    expect(rec.queries[0].calls[0][1]).toMatchObject({ p_restaurant_id: 'r-a', p_member_id: 'm-1', p_notify: false, p_broken_rules: ['outside_hours'], p_actor: 'u' })
    expect(rec.queries[0].calls[0][1]).not.toHaveProperty('p_codes')
  })

  it('R3: edit passes the loaded status and updated_at verbatim; no row = nothing changed', async () => {
    const rec = use([{ data: [] }])
    const updated = await staffBookingStore.update({
      id: 'b-1', restaurantId: 'r-a', expectedStatus: 'confirmed', expectedVersion: 7, memberId: null, input,
      clearReminder: true, actorUserId: 'u', changed: ['time'], brokenRules: [],
    })
    expect(updated).toBeNull()
    expect(rec.queries[0].calls[0][1]).toMatchObject({ p_id: 'b-1', p_restaurant_id: 'r-a', p_expected_status: 'confirmed', p_expected_version: 7, p_clear_reminder: true, p_changed: ['time'] })
  })

  it('cancel and check-in are the 095 RPCs scoped by restaurant', async () => {
    const rec = use([{ data: [] }, { data: [] }, { data: [] }])
    await staffBookingStore.cancel({ id: 'b-1', restaurantId: 'r-a', expectedVersion: 7, actorUserId: 'u', at: AT })
    expect(rec.queries[0].calls[0][1]).toMatchObject({ p_expected_version: 7 })
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

  it('R12 / R2: today reads only this restaurant\'s live rows', async () => {
    const rec = use((q) => (q.calls.some((c) => c[0] === 'limit') ? { data: [ROW, ROW] } : { data: null }))
    expect((await checkinStore.listForDate('r-a', '2026-11-26', 1)).truncated).toBe(true)
    expect(filtersOf(rec.queries[0])).toEqual(['eq:restaurant_id=r-a', 'eq:booking_date=2026-11-26', 'or:status.in.(pending,confirmed,no_show),and(status.eq.awaiting_deposit,source.eq.staff)'])
    expect(rec.queries[0].calls).toContainEqual(['limit', 2])
  })

  it('decision 8: a confirm is develop\'s single UPDATE (no code column, no retry)', async () => {
    const rec = use([{ data: ROW }])
    await decideBookingRequest({ id: 'b-1', restaurantId: 'r-a', decision: 'confirmed', decidedBy: 'u', decidedAt: AT, declineReason: null })
    expect(rec.queries).toHaveLength(1)
    expect(rec.queries[0].calls[0]).toEqual(['update', { status: 'confirmed', decided_by: 'u', decided_at: AT.toISOString(), decline_reason: null }])
    expect(filtersOf(rec.queries[0])).toEqual(['eq:id=b-1', 'eq:restaurant_id=r-a', 'eq:status=pending'])
  })
})

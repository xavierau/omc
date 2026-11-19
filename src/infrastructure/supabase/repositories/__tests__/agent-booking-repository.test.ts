// BOOK-003: the SHAPE of the agent booking queries (scoping, conditional
// filters, what each write sets). The SQL semantics are proven against real
// Postgres in agent-booking.db.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { recordingSupabase, filtersOf } from '@/test-utils/recording-supabase'

vi.mock('@/infrastructure/supabase/client', () => ({ createServerSupabaseClient: vi.fn() }))

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import {
  countLiveUnverified,
  findAgentBooking,
  findRestaurantByAgentPublicId,
  insertAgentBooking,
  promoteAgentBooking,
  purgeUnverifiedBookings,
  replaceAgentStatusToken,
} from '../agent-booking-repository'
import { findBookingForRestaurant } from '../booking-request-repository'

const ROW = {
  id: 'b-1', restaurant_id: 'r-a', member_id: null, phone: '+85291234567', name: 'Chan', party_size: 4,
  booking_date: '2026-11-20', booking_time: '19:30:00', notes: null, status: 'unverified', decline_reason: null,
  decided_by: null, decided_at: null, source: 'agent', campaign_id: null, created_at: '2026-11-19T02:00:00Z',
  decision_message_status: null, confirm_code: 'K7PX3M', verify_expires_at: '2026-11-19T02:30:00Z', verified_at: null,
  verified_wamid: null, status_token_hash: 'a'.repeat(64), idempotency_key: 'k-1',
}
const NEW = {
  restaurantId: 'r-a', phone: '+85291234567', name: 'Chan', partySize: 4, bookingDate: '2026-11-20', bookingTime: '19:30',
  notes: null, confirmCode: 'K7PX3M', verifyExpiresAt: '2026-11-19T02:30:00Z', statusTokenHash: 'a'.repeat(64), idempotencyKey: 'k-1',
}

function use(results: Parameters<typeof recordingSupabase>[0]) {
  const rec = recordingSupabase(results)
  vi.mocked(createServerSupabaseClient).mockReturnValue(rec.client as never)
  return rec
}

beforeEach(() => vi.clearAllMocks())

describe('agent-booking-repository', () => {
  it('R35/R42: inserts one row, status unverified, source agent, no member, no token; maps the agent columns back', async () => {
    const rec = use([{ data: ROW }])
    const result = await insertAgentBooking(NEW)
    expect(rec.queries).toHaveLength(1)
    expect(rec.queries[0].table).toBe('booking_requests')
    const [, values] = rec.queries[0].calls.find(([m]) => m === 'insert') as [string, Record<string, unknown>]
    expect(values).toMatchObject({
      status: 'unverified', source: 'agent', member_id: null, token: null, confirm_code: 'K7PX3M',
      verify_expires_at: NEW.verifyExpiresAt, status_token_hash: NEW.statusTokenHash, idempotency_key: 'k-1',
    })
    expect(result).toMatchObject({ ok: true, booking: { status: 'unverified', source: 'agent', confirmCode: 'K7PX3M', bookingTime: '19:30' } })
  })

  it('R31/R46: a unique-index clash is a typed conflict, other errors throw without PII', async () => {
    // PostgREST errors carry `code`; the recording client's type only names `message`.
    const pgError = (code: string, message: string) => ({ error: { code, message } as { message: string } })
    const dup = (index: string) => pgError('23505', `duplicate key value violates unique constraint "${index}"`)
    use([dup('booking_requests_restaurant_confirm_code_idx')])
    expect(await insertAgentBooking(NEW)).toEqual({ ok: false, conflict: 'confirm_code' })
    use([dup('booking_requests_restaurant_idempotency_key_idx')])
    expect(await insertAgentBooking(NEW)).toEqual({ ok: false, conflict: 'idempotency_key' })
    use([pgError('23514', 'violates check for +85291234567')])
    await expect(insertAgentBooking(NEW)).rejects.toThrow(/^insertAgentBooking: 23514$/)
  })

  it('R39: counts live unverified per restaurant, optionally per phone', async () => {
    const at = new Date('2026-11-19T02:10:00.000Z')
    const rec = use([{ count: 2 }, { count: 7 }])
    expect(await countLiveUnverified('r-a', at, '+85291234567')).toBe(2)
    expect(await countLiveUnverified('r-a', at)).toBe(7)
    expect(filtersOf(rec.queries[0])).toEqual([
      'eq:restaurant_id=r-a', 'eq:status=unverified', `gt:verify_expires_at=${at.toISOString()}`, 'eq:phone=+85291234567',
    ])
    expect(filtersOf(rec.queries[1])).not.toContain('eq:phone=+85291234567')
  })

  it('R31/R32: promotion is one conditional UPDATE on restaurant, sender phone, unverified, code and expiry', async () => {
    const at = new Date('2026-11-19T02:10:00.000Z')
    const rec = use([{ data: [{ ...ROW, status: 'pending', confirm_code: null }] }])
    const promoted = await promoteAgentBooking({ restaurantId: 'r-a', phone: '+85291234567', codes: ['K7PX3M'], wamid: 'wamid.1', at })
    expect(rec.queries[0].calls[0]).toEqual([
      'update', { status: 'pending', verified_at: at.toISOString(), verified_wamid: 'wamid.1', confirm_code: null },
    ])
    expect(filtersOf(rec.queries[0])).toEqual([
      'eq:restaurant_id=r-a', 'eq:phone=+85291234567', 'eq:status=unverified', 'in:confirm_code=K7PX3M',
      `gt:verify_expires_at=${at.toISOString()}`,
    ])
    expect(promoted.map((b) => b.status)).toEqual(['pending'])
  })

  it('promotion with no codes sends no query', async () => {
    const rec = use([])
    expect(await promoteAgentBooking({ restaurantId: 'r', phone: '+1', codes: [], wamid: 'w', at: new Date() })).toEqual([])
    expect(rec.queries).toEqual([])
  })

  it('R36: the status lookup and token replacement are scoped by id, restaurant and source agent', async () => {
    const rec = use([{ data: ROW }, { error: null }])
    await findAgentBooking('b-1', 'r-a')
    await replaceAgentStatusToken('b-1', 'r-a', 'b'.repeat(64))
    expect(filtersOf(rec.queries[0])).toEqual(['eq:id=b-1', 'eq:restaurant_id=r-a', 'eq:source=agent'])
    expect(filtersOf(rec.queries[1])).toEqual(['eq:id=b-1', 'eq:restaurant_id=r-a', 'eq:source=agent'])
  })

  it('R41: the purge deletes only unverified rows created before the cutoff', async () => {
    const before = new Date('2026-11-19T01:00:00.000Z')
    const rec = use([{ data: [{ id: 'x' }, { id: 'y' }] }])
    expect(await purgeUnverifiedBookings(before)).toBe(2)
    expect(rec.queries[0].calls[0]).toEqual(['delete'])
    expect(filtersOf(rec.queries[0])).toEqual(['eq:status=unverified', `lt:created_at=${before.toISOString()}`])
  })

  it('R41: the staff lookup never returns an unverified booking', async () => {
    const rec = use([{ data: null }])
    await findBookingForRestaurant('b-1', 'r-a')
    expect(filtersOf(rec.queries[0])).toContain('neq:status=unverified')
  })

  it('R33: the directory looks up by the JSON path the unique index covers and resolves the config', async () => {
    const rec = use([{ data: { id: 'r-a', booking_config: { mode: 'simple', agentBooking: { enabled: true, publicId: 'P'.repeat(32), websiteHost: 'www.a.hk' } } } }])
    const tenant = await findRestaurantByAgentPublicId('P'.repeat(32))
    expect(rec.queries[0].table).toBe('restaurants')
    expect(filtersOf(rec.queries[0])).toEqual([`eq:booking_config->agentBooking->>publicId=${'P'.repeat(32)}`])
    expect(tenant).toMatchObject({ restaurantId: 'r-a', config: { mode: 'simple', agentBooking: { enabled: true, websiteHost: 'www.a.hk' } } })
  })
})

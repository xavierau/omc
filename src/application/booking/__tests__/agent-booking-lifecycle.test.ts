// BOOK-003 AC-5 (R41): an agent booking end to end over one set of rows.
// Unverified: not in the staff list, not decidable (404, not 409), and the
// agent sees awaiting_confirmation. After the diner's code and a staff
// confirm, the agent's status read says confirmed and the diner got the
// confirmed message. The staff store below applies the repository's filters
// (booking-request-repository.ts); agent-booking.db.test.ts proves the SQL.
import { describe, it, expect, beforeEach } from 'vitest'
import { FakeBookingSender, FakeBookingSettings } from '@/test-utils/fake-booking'
import { FakeRateLimiter } from '@/test-utils/fake-rate-limiter'
import { FakeClock } from '@/test-utils/fake-clock'
import type { BookingRequestStore, DecideBookingArgs } from '@/domain/ports/booking'
import type { BookingRequest } from '@/domain/entities/booking-request'
import { createAgentBooking, type CreateAgentBookingDeps } from '../create-agent-booking'
import { verifyAgentBooking } from '../verify-agent-booking'
import { getAgentBookingStatus } from '../get-agent-booking-status'
import { decideBookingRequest } from '../decide-booking-request'
import { FakeAgentBookingStore, FakeAgentDirectory, scriptedSecrets } from './fake-agent-booking'

const R = 'rest-a'
const PID = 'A'.repeat(32)
const PHONE = '+85291234567'
const BODY = { date: '2026-11-20', time: '19:30', party_size: 4, name: 'Chan Tai Man', phone: PHONE }

/** booking-request-repository.ts semantics over the shared rows. */
function staffStore(rows: BookingRequest[]): BookingRequestStore {
  return {
    insert: async () => {
      throw new Error('not used')
    },
    countPending: async (restaurantId, phone) =>
      rows.filter((r) => r.restaurantId === restaurantId && r.phone === phone && r.status === 'pending').length,
    listForRestaurant: async (restaurantId) =>
      rows.filter((r) => r.restaurantId === restaurantId && ['pending', 'confirmed', 'declined'].includes(r.status)),
    findForRestaurant: async (id, restaurantId) =>
      rows.find((r) => r.id === id && r.restaurantId === restaurantId && r.status !== 'unverified') ?? null,
    confirmChange: async () => null,
    decide: async (args: DecideBookingArgs) => {
      const row = rows.find((r) => r.id === args.id && r.restaurantId === args.restaurantId && r.status === 'pending')
      if (!row) return null
      Object.assign(row, { status: args.decision, decidedBy: args.decidedBy, decidedAt: args.decidedAt.toISOString() })
      return { ...row }
    },
    recordDecisionMessage: async () => {},
  }
}

/** BOOK-008: no member has the booking phone (linking: booking-member-linking.test.ts). */
const noMembers = { findMemberId: async () => null }

let clock: FakeClock
let store: FakeAgentBookingStore
let settings: FakeBookingSettings
let sender: FakeBookingSender
let createDeps: CreateAgentBookingDeps
let directory: FakeAgentDirectory

beforeEach(() => {
  clock = new FakeClock(new Date('2026-11-19T02:00:00.000Z'))
  store = new FakeAgentBookingStore()
  store.createdAt = () => clock.now()
  directory = new FakeAgentDirectory()
  settings = new FakeBookingSettings()
  // The webhook reads the same booking_config the agent API resolved (review F2).
  settings.configs.set(R, directory.add(R, PID))
  settings.restaurants.set(R, { name: 'Cafe A', logoUrl: null, whatsappNumber: '+85230001111' })
  sender = new FakeBookingSender()
  createDeps = {
    directory, store, settings, limiter: new FakeRateLimiter(clock), secrets: scriptedSecrets(['K7PX3M']),
    privacyUrl: 'https://p', now: () => clock.now(),
  }
})

async function create() {
  const result = await createAgentBooking(createDeps, { publicId: PID, body: BODY, clientIp: '1.1.1.1', idempotencyKey: null })
  if (!result.ok || result.kind !== 'awaiting_confirmation') throw new Error('create failed')
  return result.body
}

const status = (id: string, token: string) =>
  getAgentBookingStatus({ directory, store, now: () => clock.now() }, { publicId: PID, bookingId: id, statusToken: token })

const decide = (id: string) =>
  decideBookingRequest(
    { requests: staffStore(store.rows), settings, sender, now: () => clock.now() },
    { restaurantId: R, userId: 'staff-1', bookingId: id, decision: 'confirmed' }
  )

describe('agent booking lifecycle (AC-5, R41)', () => {
  it('unverified: not in the staff list, decide → not_found (no 409 that would reveal it), no message', async () => {
    const created = await create()
    expect(await staffStore(store.rows).listForRestaurant(R, 200)).toEqual([])
    expect(await decide(created.booking_id)).toEqual({ ok: false, reason: 'not_found' })
    expect(store.rows[0].status).toBe('unverified')
    expect(sender.sent).toEqual([])
  })

  it('code from the phone → pending and listed; staff confirm → the agent reads confirmed', async () => {
    const created = await create()
    clock.advanceMs(5 * 60_000)
    const verify = await verifyAgentBooking(
      { store, members: noMembers, settings, sender, sendText: async () => {}, privacyUrl: 'https://p', now: () => clock.now() },
      { restaurantId: R, phone: PHONE, text: `Confirm ${created.confirm_code}`, wamid: 'wamid.9' }
    )
    expect(verify).toEqual({ handled: true })
    expect(await status(created.booking_id, created.status_token)).toMatchObject({ ok: true, view: { status: 'pending' } })
    expect((await staffStore(store.rows).listForRestaurant(R, 200)).map((b) => [b.id, b.source])).toEqual([[created.booking_id, 'agent']])

    const decided = await decide(created.booking_id)
    expect(decided).toMatchObject({ ok: true, booking: { status: 'confirmed' } })
    expect(sender.sent.map((m) => m.kind)).toEqual(['received', 'confirmed'])
    const read = await status(created.booking_id, created.status_token)
    expect(read).toEqual({
      ok: true,
      view: { booking_id: created.booking_id, status: 'confirmed', date: '2026-11-20', time: '19:30', party_size: 4 },
    })
  })

  it('R35: after create + verify, source, verified_at, verified_wamid and created_at are set', async () => {
    const created = await create()
    await verifyAgentBooking(
      { store, members: noMembers, settings, sender, sendText: async () => {}, privacyUrl: 'https://p', now: () => clock.now() },
      { restaurantId: R, phone: PHONE, text: created.confirm_code, wamid: 'wamid.9' }
    )
    expect(store.rows[0]).toMatchObject({
      source: 'agent', verifiedAt: clock.now().toISOString(), verifiedWamid: 'wamid.9', createdAt: '2026-11-19T02:00:00.000Z',
    })
  })
})

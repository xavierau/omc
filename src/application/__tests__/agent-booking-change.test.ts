// AGENT-003 R20–R24: the diner changes or cancels a booking by chat; staff decide changes in 訂座.
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { createAgentToolExecutor } from '@/application/agent/agent-tools'
import { cancelledText } from '@/application/agent/agent-booking-change-tools'
import { decideBookingRequest } from '@/application/booking/decide-booking-request'
import { upcomingFilter } from '@/infrastructure/supabase/repositories/booking-request-repository'
import { withDisclosure } from '@/domain/services/agent-reply-text'
import { AGENT_TOOL_NAMES, DEFAULT_DISCLOSURE_TEXT } from '@/domain/value-objects/agent-config'
import type { BookingRequest } from '@/domain/entities/booking-request'
import { FakeAgentStore, FakeClock, fakeBookingWorld, fakeToolData } from './agent-fakes'

const R = 'rest-a'
const PHONE = '+85291234567'
const OTHER_PHONE = '+85298887777'
const KEY = { restaurantId: R, phone: PHONE }
// FakeClock: 2026-11-19T10:00Z = 18:00 Hong Kong.

function setup() {
  const clock = new FakeClock()
  const store = new FakeAgentStore(clock)
  const world = fakeBookingWorld(clock)
  world.settings.setConfig(R, { mode: 'simple', maxPartySize: 8 })
  world.settings.restaurants.set(R, { name: 'OMC', logoUrl: null, whatsappNumber: null })

  async function seed(patch: Partial<BookingRequest> & { token?: string } = {}) {
    const row = await world.requests.insert({
      restaurantId: R, memberId: 'member-1', phone: PHONE, name: '陳生', partySize: 4, bookingDate: '2026-11-25',
      bookingTime: '19:30', notes: 'window seat', source: 'chat', campaignId: null, token: patch.token ?? `tok-${Math.random()}`,
    })
    Object.assign(row, patch)
    return row
  }

  /** A diner message arrives one minute later; the executor its job builds. */
  async function job() {
    // F1: the previous job's read-back reached the diner (the worker marks its proposal confirmable after the send).
    world.proposals.deliverAll()
    clock.advance(60_000)
    const row = store.seed({ restaurant_id: R, phone: PHONE, role: 'user', text: 'msg' })
    const { getConfig, ...ports } = world.deps
    const config = await getConfig(R)
    return createAgentToolExecutor({
      key: KEY,
      enabledTools: [...AGENT_TOOL_NAMES],
      handoffSilenceHours: 12,
      now: clock.now,
      data: fakeToolData(),
      silences: store,
      agentMode: 'auto',
      booking: {
        ...ports,
        config,
        inboundCreatedAt: () => store.userMessageCreatedAt(KEY, row.id),
        proposalOwner: `run-${row.id}`,
        disclosureText: DEFAULT_DISCLOSURE_TEXT,
      },
    })
  }

  const ref = (id: string) => id.slice(0, 8)
  const decide = (bookingId: string, decision: 'confirmed' | 'declined') =>
    decideBookingRequest(
      { requests: world.requests, settings: world.settings, sender: world.sender, now: clock.now },
      { restaurantId: R, userId: 'staff-1', bookingId, decision }
    )
  return { clock, world, seed, job, ref, decide }
}

describe('AC-R20 list_my_bookings: only this phone’s upcoming bookings here', () => {
  it('AC-R20 another phone’s, another tenant’s, past, declined and cancelled bookings never come back', async () => {
    const { seed, job, world } = setup()
    const mine = await seed()
    const confirmed = await seed({ bookingDate: '2026-11-21', status: 'confirmed' })
    await seed({ phone: OTHER_PHONE })
    await seed({ restaurantId: 'rest-b' })
    await seed({ bookingDate: '2026-11-18' })
    await seed({ status: 'declined' })
    await seed({ status: 'cancelled', cancelledBy: 'diner_ai' })
    const out = await (await job())('list_my_bookings', { phone: OTHER_PHONE, restaurantId: 'rest-b' })
    expect(out).toEqual({
      bookings: [
        { ref: confirmed.id.slice(0, 8), date: '2026-11-21', time: '19:30', partySize: 4, status: 'confirmed' },
        { ref: mine.id.slice(0, 8), date: '2026-11-25', time: '19:30', partySize: 4, status: 'pending' },
      ],
    })
    // F10: upcoming from the Hong Kong time now (the job runs at 18:01 HK).
    expect(world.requests.queries).toEqual([`listUpcoming restaurant_id=${R} phone=${PHONE} upcoming>=2026-11-19 18:01`])
  })

  it('AC-R20 the repository WHERE is scoped by restaurant AND phone, upcoming and open status', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/infrastructure/supabase/repositories/booking-request-repository.ts'), 'utf8')
    const fn = source.slice(source.indexOf('export async function listUpcomingDinerBookings'), source.indexOf('export async function cancelDinerBooking'))
    for (const filter of [".eq('restaurant_id', restaurantId)", ".eq('phone', phone)", ".in('status', ['pending', 'confirmed'])", '.or(upcomingFilter(from))']) {
      expect(fn).toContain(filter)
    }
    expect(upcomingFilter({ date: '2026-11-19', time: '21:00' })).toBe(
      'booking_date.gt.2026-11-19,and(booking_date.eq.2026-11-19,booking_time.gte.21:00)'
    )
  })
  it('AC-R20 refs stay unique when two of the diner’s ids share their first 8 characters, and each resolves', async () => {
    const { seed, job, world } = setup()
    const a = await seed()
    const b = await seed({ bookingDate: '2026-11-27' })
    a.id = 'b0000000-0000-4000-8000-000000000025'
    b.id = 'b0000000-0000-4000-8000-000000000027'
    const exec = await job()
    const out = (await exec('list_my_bookings', {})) as { bookings: Array<{ ref: string; date: string }> }
    const refs = out.bookings.map((x) => x.ref)
    expect(new Set(refs).size).toBe(2)
    expect(refs.every((r) => r.length >= 8)).toBe(true)
    const later = out.bookings.find((x) => x.date === '2026-11-27')!
    expect(await exec('propose_booking_cancel', { bookingRef: later.ref })).toMatchObject({ proposed: true, booking: { date: '2026-11-27' } })
    expect(await exec('propose_booking_cancel', { bookingRef: 'b0000000' })).toMatchObject({ error: 'not_found' })
    expect(world.proposals.entries.size).toBe(1)
  })
})

describe('AC-R21 bookingRef resolves only inside the diner’s own upcoming bookings', () => {
  it.each([
    ['another phone', { phone: OTHER_PHONE }],
    ['another tenant', { restaurantId: 'rest-b' }],
    ['a past booking', { bookingDate: '2026-11-18' }],
    ['a declined booking', { status: 'declined' as const }],
    ['a cancelled booking', { status: 'cancelled' as const, cancelledBy: 'diner_ai' as const }],
  ])('AC-R21 %s → not_found for change and cancel, nothing stored', async (_label, patch) => {
    const { seed, job, ref, world } = setup()
    const target = await seed(patch)
    const exec = await job()
    expect(await exec('propose_booking_change', { bookingRef: ref(target.id), time: '20:00' })).toMatchObject({ error: 'not_found' })
    expect(await exec('propose_booking_cancel', { bookingRef: ref(target.id) })).toMatchObject({ error: 'not_found' })
    expect(world.proposals.entries.size).toBe(0)
  })

  it('AC-R21 a malformed or unknown ref → not_found', async () => {
    const { seed, job } = setup()
    await seed()
    const exec = await job()
    for (const bookingRef of ['', 'abc', "' or 1=1 --", 'zzzzzzzz', undefined]) {
      expect(await exec('propose_booking_cancel', { bookingRef })).toMatchObject({ error: 'not_found' })
    }
  })

  it('AC-R21 new values go through BOOK-001 validation; no change at all is refused', async () => {
    const { seed, job, ref, world } = setup()
    const target = await seed()
    const exec = await job()
    expect(await exec('propose_booking_change', { bookingRef: ref(target.id), partySize: 9 })).toMatchObject({ error: 'invalid', fields: { partySize: 'too_large' } })
    expect(await exec('propose_booking_change', { bookingRef: ref(target.id), time: '25:00' })).toMatchObject({ error: 'invalid', fields: { time: 'invalid' } })
    expect(await exec('propose_booking_change', { bookingRef: ref(target.id), date: '2026-11-18' })).toMatchObject({ error: 'invalid', fields: { date: 'past' } })
    expect(await exec('propose_booking_change', { bookingRef: ref(target.id) })).toMatchObject({ error: 'nothing_to_change' })
    expect(world.proposals.entries.size).toBe(0)
  })
})

describe('AC-R22 the two-step gate for change and cancel', () => {
  for (const kind of ['change', 'cancel'] as const) {
    const propose = kind === 'change' ? 'propose_booking_change' : 'propose_booking_cancel'
    const confirm = kind === 'change' ? 'confirm_booking_change' : 'confirm_booking_cancel'
    const args = (bookingRef: string) => (kind === 'change' ? { bookingRef, date: '2026-11-26', time: '20:00' } : { bookingRef })
    const changed = (world: ReturnType<typeof setup>['world']) =>
      kind === 'change' ? world.requests.rows.filter((r) => r.replacesBookingId).length : world.requests.rows.filter((r) => r.status === 'cancelled').length

    it(`AC-R22 ${kind}: no proposal → refused`, async () => {
      const { seed, job, world } = setup()
      await seed()
      expect(await (await job())(confirm, {})).toMatchObject({ error: 'no_proposal' })
      expect(changed(world)).toBe(0)
    })

    it(`AC-R22 ${kind}: same job → refused; the next message confirms`, async () => {
      const { seed, job, ref, world } = setup()
      const target = await seed()
      const same = await job()
      expect(await same(propose, args(ref(target.id)))).toMatchObject({ proposed: true })
      expect(await same(confirm, {})).toMatchObject({ error: 'awaiting_diner_confirmation' })
      expect(changed(world)).toBe(0)
      expect(await (await job())(confirm, {})).not.toHaveProperty('error')
      expect(changed(world)).toBe(1)
    })

    it(`AC-R22 ${kind}: expired after 30 min → refused`, async () => {
      const { seed, job, ref, world, clock } = setup()
      const target = await seed()
      await (await job())(propose, args(ref(target.id)))
      clock.advance(30 * 60_000)
      expect(await (await job())(confirm, {})).toMatchObject({ error: 'no_proposal' })
      expect(changed(world)).toBe(0)
    })

    it(`AC-R22 ${kind}: single use`, async () => {
      const { seed, job, ref, world } = setup()
      const target = await seed()
      await (await job())(propose, args(ref(target.id)))
      const next = await job()
      await next(confirm, {})
      expect(await next(confirm, {})).toMatchObject({ error: 'no_proposal' })
      expect(changed(world)).toBe(1)
    })
  }

  it('AC-R22 one proposal per conversation across kinds: a cancel proposal replaces a booking proposal', async () => {
    const { seed, job, ref, world } = setup()
    const target = await seed()
    await (await job())('propose_booking', { date: '2026-11-22', time: '19:00', partySize: 2, name: '陳生' })
    await (await job())('propose_booking_cancel', { bookingRef: ref(target.id) })
    const next = await job()
    expect(await next('create_booking_request', {})).toMatchObject({ error: 'no_proposal' })
    expect(await next('confirm_booking_cancel', {})).toMatchObject({ cancelled: true })
    expect(world.requests.rows.filter((r) => r.source === 'agent')).toHaveLength(0)
  })
})

describe('AC-R23 change = a linked change request staff decide in 訂座', () => {
  async function requestChange() {
    const s = setup()
    const original = await s.seed({ status: 'confirmed', decidedAt: '2026-11-19T09:00:00.000Z', decidedBy: 'staff-0' })
    const propose = await (await s.job())('propose_booking_change', { bookingRef: s.ref(original.id), date: '2026-11-26', time: '20:00' })
    expect(propose).toMatchObject({
      proposed: true,
      from: { date: '2026-11-25', time: '19:30', partySize: 4 },
      to: { date: '2026-11-26', time: '20:00', partySize: 4 },
    })
    expect(await (await s.job())('confirm_booking_change', {})).toMatchObject({ changeRequested: true, status: 'pending' })
    const change = s.world.requests.rows.find((r) => r.replacesBookingId === original.id)!
    return { ...s, original, change }
  }

  it('AC-R23 the change request is pending, linked, carries the original’s name/notes/member and source agent; the original is untouched', async () => {
    const { original, change, world } = await requestChange()
    expect(change).toMatchObject({
      status: 'pending', source: 'agent', replacesBookingId: original.id, bookingDate: '2026-11-26', bookingTime: '20:00',
      partySize: 4, name: '陳生', notes: 'window seat', memberId: 'member-1', phone: PHONE, restaurantId: R,
    })
    expect(world.requests.rows.find((r) => r.id === original.id)).toMatchObject({ status: 'confirmed', bookingDate: '2026-11-25' })
    expect(world.sender.sent.map((m) => [m.kind, m.details.date])).toEqual([['received', '2026-11-26']])
  })

  it('AC-R23 a second change while one is open → change_already_pending', async () => {
    const { original, job, ref } = await requestChange()
    expect(await (await job())('propose_booking_change', { bookingRef: ref(original.id), time: '21:00' })).toMatchObject({ error: 'change_already_pending' })
  })

  it('AC-R23 staff confirm → the change confirmed and the original cancelled (by change); diner gets "confirmed" for the new time', async () => {
    const { original, change, world, decide } = await requestChange()
    const result = await decide(change.id, 'confirmed')
    expect(result).toMatchObject({ ok: true, booking: { id: change.id, status: 'confirmed' } })
    expect(world.requests.rows.find((r) => r.id === original.id)).toMatchObject({ status: 'cancelled', cancelledBy: 'change' })
    expect(world.sender.sent.at(-1)).toMatchObject({ kind: 'confirmed', details: { date: '2026-11-26', time: '20:00' } })
  })

  it('AC-R23 staff decline → the original stays as it was; no "declined" message about it', async () => {
    const { original, change, world, decide } = await requestChange()
    const sentBefore = world.sender.sent.length
    // F8: no message by design → delivered null (not false), so no "not delivered" badge.
    expect(await decide(change.id, 'declined')).toMatchObject({ ok: true, booking: { status: 'declined' }, delivered: null })
    expect(world.requests.rows.find((r) => r.id === original.id)).toMatchObject({ status: 'confirmed', bookingDate: '2026-11-25', cancelledBy: null })
    expect(world.sender.sent.slice(sentBefore)).toEqual([])
  })

  it('AC-R23 a failure inside the swap leaves both rows as before (one transaction)', async () => {
    const { original, change, world, decide } = await requestChange()
    world.requests.failConfirmChangeCancel = true
    await expect(decide(change.id, 'confirmed')).rejects.toThrow()
    expect(world.requests.rows.find((r) => r.id === original.id)?.status).toBe('confirmed')
    expect(world.requests.rows.find((r) => r.id === change.id)?.status).toBe('pending')
  })

  it('AC-R23 a booking without a change link takes the old confirm path (BOOK-001 / BOOK-003 unchanged)', async () => {
    const { seed, decide, world } = setup()
    const plain = await seed()
    expect(await decide(plain.id, 'confirmed')).toMatchObject({ ok: true, booking: { status: 'confirmed' } })
    expect(world.sender.sent.at(-1)?.kind).toBe('confirmed')
  })

  it('AC-R23 migration 085: confirm_booking_change does both updates in one function, scoped by restaurant', () => {
    const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/085_agent_booking_changes.sql'), 'utf8')
    const fn = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.confirm_booking_change'), sql.indexOf('REVOKE ALL ON FUNCTION public.confirm_booking_change'))
    expect(fn).toMatch(/SET status = 'confirmed'[\s\S]*AND restaurant_id = p_restaurant_id[\s\S]*AND status = 'pending'[\s\S]*AND replaces_booking_id IS NOT NULL/)
    expect(fn).toMatch(/SET status = 'cancelled', cancelled_by = 'change'[\s\S]*AND restaurant_id = p_restaurant_id[\s\S]*AND status IN \('pending', 'confirmed'\)/)
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.confirm_booking_change(uuid, uuid, uuid, timestamptz) TO service_role;')
    expect(sql).toMatch(/CREATE UNIQUE INDEX booking_requests_one_pending_change_idx[\s\S]*WHERE replaces_booking_id IS NOT NULL AND status = 'pending'/)
  })
})

describe('AC-R24 cancel is direct, marked, texted once; reminders skip it', () => {
  it('AC-R24 a confirmed upcoming booking → cancelled by diner_ai, its open change request too, the diner texted once', async () => {
    const { seed, job, ref, world } = setup()
    const target = await seed({ status: 'confirmed', decidedAt: '2026-11-19T09:00:00.000Z' })
    const openChange = await seed({ replacesBookingId: target.id, bookingDate: '2026-11-26' })
    expect(await (await job())('propose_booking_cancel', { bookingRef: ref(target.id) })).toMatchObject({
      proposed: true,
      booking: { date: '2026-11-25', time: '19:30', partySize: 4, status: 'confirmed' },
    })
    expect(world.texts).toEqual([])
    expect(await (await job())('confirm_booking_cancel', {})).toMatchObject({ cancelled: true })
    expect(world.requests.rows.find((r) => r.id === target.id)).toMatchObject({ status: 'cancelled', cancelledBy: 'diner_ai' })
    expect(world.requests.rows.find((r) => r.id === openChange.id)).toMatchObject({ status: 'cancelled', cancelledBy: 'diner_ai' })
    expect(world.texts).toEqual([{ restaurantId: R, phone: PHONE, text: withDisclosure(cancelledText(target), DEFAULT_DISCLOSURE_TEXT) }])
    expect(world.requests.queries.at(-1)).toBe(`cancelByDiner restaurant_id=${R} phone=${PHONE} id=${target.id}`)
  })

  it('AC-R24 a pending booking can be cancelled too', async () => {
    const { seed, job, ref, world } = setup()
    const target = await seed()
    await (await job())('propose_booking_cancel', { bookingRef: ref(target.id) })
    await (await job())('confirm_booking_cancel', {})
    expect(world.requests.rows[0]).toMatchObject({ status: 'cancelled', cancelledBy: 'diner_ai' })
  })

  it('AC-R24 a booking that became past (or closed) between propose and confirm → refused, nothing texted', async () => {
    const { seed, job, ref, world } = setup()
    const target = await seed({ bookingDate: '2026-11-19', bookingTime: '23:00' })
    await (await job())('propose_booking_cancel', { bookingRef: ref(target.id) })
    target.status = 'declined'
    expect(await (await job())('confirm_booking_cancel', {})).toMatchObject({ error: 'not_found' })
    expect(world.texts).toEqual([])
  })

  it('AC-R24 a failed text does not undo the cancel', async () => {
    const { seed, job, ref, world } = setup()
    world.deps.notifyText = async () => false
    const target = await seed()
    await (await job())('propose_booking_cancel', { bookingRef: ref(target.id) })
    expect(await (await job())('confirm_booking_cancel', {})).toMatchObject({ cancelled: true })
    expect(world.requests.rows[0].status).toBe('cancelled')
  })

  it('AC-R24 the reminder cron reads and claims only confirmed bookings, so cancelled ones are skipped', () => {
    const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/082_booking.sql'), 'utf8')
    const rpc = sql.slice(sql.indexOf('booking_reminder_candidates'))
    expect(rpc).toContain("WHERE b.status = 'confirmed'")
    const repo = fs.readFileSync(path.join(process.cwd(), 'src/infrastructure/supabase/repositories/booking-request-repository.ts'), 'utf8')
    const claim = repo.slice(repo.indexOf('export async function claimBookingReminder'), repo.indexOf('export async function purgeBookingPii'))
    expect(claim).toContain(".eq('status', 'confirmed')")
  })

  it('AC-R24 migration 085: cancelled status, marker and cancel time are enforced together', () => {
    const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/085_agent_booking_changes.sql'), 'utf8')
    expect(sql).toContain("CHECK (status IN ('unverified', 'pending', 'confirmed', 'declined', 'cancelled'))")
    expect(sql).toContain("CHECK ((status = 'cancelled') = (cancelled_by IS NOT NULL))")
    expect(sql).toContain("OR (status = 'cancelled' AND cancelled_at IS NOT NULL)")
  })
})

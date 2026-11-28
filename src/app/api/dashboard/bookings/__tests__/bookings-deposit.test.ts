/**
 * BOOK-014 W4 (spec AC-11, AC-12, AC-13, AC-14; threat R56, R58, R60): staff
 * create with a deposit, decline -> automatic refund, Refund / Keep / Retry
 * and Copy link, run for real over the in-memory deposit ledger and the test
 * provider adapter (spec AC-16). Only the session and the WhatsApp send are faked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { FakeStaffBookings } from '@/test-utils/fake-staff-booking'
import { FakeBookingRoom } from '@/application/booking/__tests__/fake-booking-room'
import { paymentWorld, PER_GUEST_100, RESTAURANT, OTHER_RESTAURANT } from '@/test-utils/payment-world'
import { DEFAULT_BOOKING_CONFIG, type BookingConfig } from '@/domain/value-objects/booking-config'
import { STAFF_HOLD_MS } from '@/domain/entities/booking-deposit'
import type { BookingRequest } from '@/domain/entities/booking-request'
import { buildBookingText } from '@/domain/services/booking-message'
import { parseE164Phone } from '@/infrastructure/phone/e164-parser'
import { isPhoneNormalizeError } from '@/domain/ports/phone-normalizer'
import type { StaffBookingDeps } from '@/application/booking/staff-booking-shared'
import type { BookingMessageInput, BookingRequestStore, BookingSendResult } from '@/domain/ports/booking'
import type { DepositDecisionDeps, StaffDepositLinkDeps } from '@/application/payments/deposit-decisions'
import { decideBookingRequest, type DecideBookingDeps } from '@/application/booking/decide-booking-request'

const world: { staff: StaffBookingDeps | null; decisions: DepositDecisionDeps | null; link: StaffDepositLinkDeps | null } = {
  staff: null,
  decisions: null,
  link: null,
}

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/application/booking/booking-deps', () => ({ staffBookingDeps: () => world.staff }))
vi.mock('@/application/payments/payment-deps', () => ({
  depositDecisionDeps: () => world.decisions,
  staffDepositLinkDeps: () => world.link,
}))
vi.mock('@/infrastructure/supabase/repositories/booking-room-repository', () => ({ findStaffDisplayName: vi.fn(async () => 'Mandy') }))

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { POST as createRoute } from '../route'
import { POST as refundRoute } from '../[id]/deposit/refund/route'
import { POST as keepRoute } from '../[id]/deposit/keep/route'
import { GET as linkRoute } from '../[id]/deposit/link/route'

const STAFF = '7c0f4a3e-0000-4000-8000-00000000aaaa'
// Thursday 2026-11-26 11:00 in Hong Kong.
const NOW = new Date('2026-11-26T03:00:00Z')
const form = { phone: '9123 4567', name: 'Chan Tai Man', partySize: 4, date: '2026-11-28', time: '19:00', notes: null }

let pw: ReturnType<typeof paymentWorld>
let fake: FakeStaffBookings
let config: BookingConfig
let sends: BookingMessageInput[]
let sendResult: BookingSendResult

const normalizePhone = (raw: string) => {
  const p = parseE164Phone(raw)
  return isPhoneNormalizeError(p) ? null : p.value
}

function as(restaurantId = RESTAURANT, role = 'staff') {
  vi.mocked(getTenantContext).mockResolvedValue({ userId: STAFF, restaurantId, role, tenantStatus: 'active' })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  pw = paymentWorld(NOW)
  fake = new FakeStaffBookings(pw.ledger)
  config = { ...structuredClone(DEFAULT_BOOKING_CONFIG), mode: 'simple', maxPartySize: 12, deposit: PER_GUEST_100 }
  sends = []
  sendResult = { delivered: true, via: 'template' }
  world.staff = {
    store: fake,
    settings: {
      getConfig: async () => config,
      getRestaurant: async () => ({ name: 'Walk Test Kitchen', logoUrl: null, whatsappNumber: null }),
      getCampaignBookingUrl: async () => null,
    },
    room: new FakeBookingRoom(() => fake.rows),
    members: { findMemberId: async () => null },
    sender: { send: async (input) => (sends.push(input), sendResult) },
    normalizePhone,
    recordMessage: async () => {},
    now: () => NOW,
    deposit: { accounts: pw.accounts, start: pw.startDeps },
  }
  world.decisions = pw.decisionDeps
  world.link = {
    deposits: pw.ledger,
    registry: pw.registry,
    findBooking: async (id, restaurantId) => (await fake.find(id, restaurantId)) ?? null,
  }
  as()
})

const json = (body: unknown) => new NextRequest('http://localhost/api/dashboard/bookings', { method: 'POST', body: JSON.stringify(body) })
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const post = (route: typeof refundRoute, id: string) => route(new Request('http://localhost/x', { method: 'POST' }), ctx(id))
const depositOf = (bookingId: string) => [...pw.ledger.deposits.values()].find((d) => d.bookingId === bookingId)
const providerRefunds = () => [...(pw.gateway as unknown as { refunds: Map<string, unknown> }).refunds.values()].length

/** A paid deposit booking (staff create -> the diner pays -> confirmed), then moved to `status` as cancel / no-show would. */
async function paidStaffBooking(status?: BookingRequest['status']) {
  const { booking } = await (await createRoute(json(form))).json()
  const deposit = depositOf(booking.id)!
  await pw.deliver(pw.gateway.completeSession(deposit.providerSessionId!))
  if (status) pw.ledger.setBookingStatus(booking.id, status)
  return booking.id as string
}

describe('POST /api/dashboard/bookings — staff create with a deposit (AC-11)', () => {
  it('rule applies + active account + phone: awaiting_deposit, created_by, 24 h staff hold, the deposit request goes out with the /p link', async () => {
    const res = await createRoute(json(form))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.booking).toMatchObject({ status: 'awaiting_deposit', source: 'staff', createdBy: STAFF, decidedAt: null })
    expect(body.booking.deposit).toMatchObject({ status: 'awaiting', amount: { amountMinor: 40000, currency: 'HKD' } })
    expect(body.paymentUrl).toBe(`https://app.example.test/p/${pw.tokens[0]}`)
    expect(body.message).toBe('delivered')
    const deposit = depositOf(body.booking.id)!
    expect(Date.parse(deposit.holdExpiresAt) - NOW.getTime()).toBe(STAFF_HOLD_MS)
    expect(pw.ledger.eventsOf(deposit.id)).toEqual(['created:user', 'session_created:system'])
    expect(pw.ledger.events[0].userId).toBe(STAFF)
    expect(sends).toHaveLength(1)
    expect(sends[0]).toMatchObject({ kind: 'deposit_request', phone: '+85291234567' })
    expect(sends[0].details.depositRequest).toMatchObject({
      amount: { amountMinor: 40000, currency: 'HKD' },
      linkToken: pw.tokens[0],
      linkUrl: body.paymentUrl,
      // 2026-11-26 11:00 HK + 24 h - 2 min.
      holdUntil: '2026-11-27 10:58',
    })
  })

  it('paid -> confirmed by its creator (the webhook, W1 mapping)', async () => {
    const { booking } = await (await createRoute(json(form))).json()
    await pw.deliver(pw.gateway.completeSession(depositOf(booking.id)!.providerSessionId!))
    expect(pw.ledger.booking(booking.id)).toMatchObject({ status: 'confirmed', decidedBy: STAFF })
    expect(depositOf(booking.id)!.status).toBe('paid')
  })

  it('turned off: confirmed, no deposit, and a waived event with the staff user and the amount (R60)', async () => {
    const { booking } = await (await createRoute(json({ ...form, requireDeposit: false }))).json()
    expect(booking).toMatchObject({ status: 'confirmed', source: 'staff' })
    expect(depositOf(booking.id)).toBeUndefined()
    expect(fake.waivers).toEqual([{ bookingId: booking.id, restaurantId: RESTAURANT, userId: STAFF, amount: { amountMinor: 40000, currency: 'HKD' } }])
    expect(sends[0].kind).toBe('confirmed')
  })

  it('no phone: no deposit option (confirmed, nothing waived, no provider session)', async () => {
    const { booking } = await (await createRoute(json({ ...form, phone: '' }))).json()
    expect(booking.status).toBe('confirmed')
    expect(pw.ledger.deposits.size).toBe(0)
    expect(fake.waivers).toEqual([])
  })

  it('below the rule, or the account not active: created without a deposit (AC-4)', async () => {
    config.deposit = { ...PER_GUEST_100, fromPartySize: 6 }
    expect((await (await createRoute(json(form))).json()).booking.status).toBe('confirmed')
    config.deposit = PER_GUEST_100
    pw.accounts.set({ restaurantId: RESTAURANT, status: 'restricted', chargesEnabled: false })
    expect((await (await createRoute(json(form))).json()).booking.status).toBe('confirmed')
    expect(pw.ledger.deposits.size).toBe(0)
  })

  it('template missing / not approved: not_delivered + the link to copy; Copy link reads it back later', async () => {
    sendResult = { delivered: false, reason: 'outside_window' }
    const body = await (await createRoute(json(form))).json()
    expect(body.message).toBe('not_delivered')
    expect(body.paymentUrl).toMatch(/^https:\/\/app\.example\.test\/p\//)
    const res = await linkRoute(new Request('http://localhost/x'), ctx(body.booking.id))
    expect(res.status).toBe(200)
    expect((await res.json()).url).toBe(depositOf(body.booking.id)!.sessionUrl)
  })

  it('R54: the provider is down at create -> 503 payment_unavailable, the hold released at once', async () => {
    pw.gateway.failNext('createHostedPayment')
    const res = await createRoute(json(form))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'payment_unavailable' })
    const [deposit] = [...pw.ledger.deposits.values()]
    expect(deposit.status).toBe('lapsed')
    expect(sends).toHaveLength(0)
  })
})

describe('Refund / Keep / Retry (AC-13, R56, R58, R60)', () => {
  it.each(['cancelled', 'no_show'] as const)('%s + paid: Refund refunds in full once, by the staff user; a second Refund and a Keep after it -> 409', async (status) => {
    const id = await paidStaffBooking(status)
    const res = await post(refundRoute, id)
    expect(res.status).toBe(200)
    expect((await res.json()).deposit).toMatchObject({ status: 'refunded', refundReason: 'staff' })
    expect(providerRefunds()).toBe(1)
    const deposit = depositOf(id)!
    expect(deposit.decidedBy).toBe(STAFF)
    expect(pw.ledger.events.filter((e) => e.depositId === deposit.id && e.type === 'refund_requested')).toEqual([
      { depositId: deposit.id, type: 'refund_requested', actor: 'user', userId: STAFF, ref: null },
    ])
    const again = await post(refundRoute, id)
    expect(again.status).toBe(409)
    expect(await again.json()).toEqual({ error: 'conflict', status: 'refunded' })
    expect((await post(keepRoute, id)).status).toBe(409)
    expect(providerRefunds()).toBe(1)
  })

  it.each(['cancelled', 'no_show'] as const)('%s + paid: Keep is recorded with the user and ends the choice (Refund after Keep -> 409, no provider call)', async (status) => {
    const id = await paidStaffBooking(status)
    const res = await post(keepRoute, id)
    expect(res.status).toBe(200)
    expect((await res.json()).deposit).toMatchObject({ status: 'kept' })
    const deposit = depositOf(id)!
    expect(pw.ledger.events.filter((e) => e.depositId === deposit.id && e.type === 'kept')).toEqual([
      { depositId: deposit.id, type: 'kept', actor: 'user', userId: STAFF, ref: null },
    ])
    expect((await post(refundRoute, id)).status).toBe(409)
    expect(providerRefunds()).toBe(0)
  })

  it('a confirmed (going ahead) booking: Refund and Keep -> 409, nothing moves', async () => {
    const id = await paidStaffBooking()
    expect((await post(refundRoute, id)).status).toBe(409)
    expect((await post(keepRoute, id)).status).toBe(409)
    expect(depositOf(id)!.status).toBe('paid')
  })

  it('R58: restaurant B staff on A\'s booking -> 404 and no provider call; a malformed id -> 404', async () => {
    const id = await paidStaffBooking('cancelled')
    as(OTHER_RESTAURANT)
    expect((await post(refundRoute, id)).status).toBe(404)
    expect((await post(keepRoute, id)).status).toBe(404)
    expect((await linkRoute(new Request('http://localhost/x'), ctx(id))).status).toBe(404)
    expect(providerRefunds()).toBe(0)
    expect(depositOf(id)!.status).toBe('paid')
    as()
    expect((await post(refundRoute, 'not-a-uuid')).status).toBe(404)
  })

  it('a refund the provider refuses -> refund_failed; Refund on it is Retry (attempt 2, a new key) -> refunded', async () => {
    const id = await paidStaffBooking('cancelled')
    pw.gateway.refundOutcome = 'failed'
    expect((await (await post(refundRoute, id)).json()).deposit.status).toBe('refund_failed')
    pw.gateway.refundOutcome = 'succeeded'
    const retried = await post(refundRoute, id)
    expect(retried.status).toBe(200)
    expect((await retried.json()).deposit.status).toBe('refunded')
    expect(depositOf(id)!.refundAttempts).toBe(2)
  })

  it('a role outside admin / staff -> 403', async () => {
    const id = await paidStaffBooking('cancelled')
    as(RESTAURANT, 'viewer')
    expect((await post(refundRoute, id)).status).toBe(403)
  })

  it('Copy link on a booking that is no longer awaiting (paid) -> 409', async () => {
    const id = await paidStaffBooking()
    expect((await linkRoute(new Request('http://localhost/x'), ctx(id))).status).toBe(409)
  })
})

describe('decline of a paid booking -> automatic refund (AC-12, R56)', () => {
  /** The decide store over the ledger's booking rows (one table in the database). */
  function decideDeps(): DecideBookingDeps & { sent: BookingMessageInput[] } {
    const sent: BookingMessageInput[] = []
    const requests = {
      async decide(args: { id: string; restaurantId: string; decision: 'confirmed' | 'declined'; declineReason: string | null }) {
        const b = pw.ledger.booking(args.id)
        if (!b || b.restaurantId !== args.restaurantId || b.status !== 'pending') return null
        pw.ledger.setBookingStatus(args.id, args.decision)
        return { ...pw.ledger.booking(args.id)!, declineReason: args.declineReason, notifyDiner: true }
      },
      async confirmChange() {
        return null
      },
      async findForRestaurant(id: string, restaurantId: string) {
        const b = pw.ledger.booking(id)
        return b && b.restaurantId === restaurantId ? b : null
      },
      async recordDecisionMessage() {},
    } as unknown as BookingRequestStore
    return {
      requests,
      settings: { getRestaurant: async () => ({ name: 'Café A', logoUrl: null, whatsappNumber: null }) },
      sender: { send: async (input) => (sent.push(input), { delivered: true, via: 'text' }) },
      now: () => NOW,
      deposits: pw.decisionDeps,
      sent,
    }
  }

  async function paidDinerBooking() {
    const started = await pw.book()
    if (started.kind !== 'started') throw new Error('not started')
    await pw.deliver(pw.gateway.completeSession(depositOf(started.booking.id)!.providerSessionId!))
    expect(pw.ledger.booking(started.booking.id)!.status).toBe('pending')
    return started.booking.id
  }

  it('one full refund, reason declined, by the staff user; the decline message says the deposit will be refunded (zh-HK + en)', async () => {
    const id = await paidDinerBooking()
    const deps = decideDeps()
    const result = await decideBookingRequest(deps, { restaurantId: RESTAURANT, userId: STAFF, bookingId: id, decision: 'declined', reason: 'Fully booked' })
    expect(result).toMatchObject({ ok: true, booking: { status: 'declined', deposit: { status: 'refunded', refundReason: 'declined' } } })
    expect(providerRefunds()).toBe(1)
    expect(depositOf(id)).toMatchObject({ status: 'refunded', refundReason: 'declined', decidedBy: STAFF })
    expect(deps.sent).toHaveLength(1)
    expect(deps.sent[0].details.depositRefund).toEqual({ amountMinor: 40000, currency: 'HKD' })
    expect(buildBookingText('declined', 'en', deps.sent[0].details)).toContain('Your deposit HK$400 will be refunded.')
    expect(buildBookingText('declined', 'zh_hk', deps.sent[0].details)).toContain('你的訂金 HK$400 將會退回。')
  })

  it('the provider refuses: the decline stands, the deposit is refund_failed (Retry), the message still says it will be refunded', async () => {
    const id = await paidDinerBooking()
    pw.gateway.failNext('refund')
    const result = await decideBookingRequest(decideDeps(), { restaurantId: RESTAURANT, userId: STAFF, bookingId: id, decision: 'declined' })
    expect(result).toMatchObject({ ok: true, booking: { status: 'declined', deposit: { status: 'refund_failed' } } })
    expect(pw.ledger.booking(id)!.status).toBe('declined')
    expect(depositOf(id)!.status).toBe('refund_failed')
  })

  it('a booking without a deposit declines as before (no refund line, no provider call)', async () => {
    const id = crypto.randomUUID()
    pw.ledger.bookings.set(id, { ...pw.request(), id, status: 'pending', declineReason: null, decidedBy: null, decidedAt: null, createdAt: NOW.toISOString(), decisionMessageStatus: null } as BookingRequest)
    const deps = decideDeps()
    const result = await decideBookingRequest(deps, { restaurantId: RESTAURANT, userId: STAFF, bookingId: id, decision: 'declined' })
    expect(result).toMatchObject({ ok: true, booking: { status: 'declined' } })
    expect(providerRefunds()).toBe(0)
    expect(deps.sent[0].details.depositRefund ?? null).toBeNull()
  })
})

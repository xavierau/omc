// BOOK-014 W3 (spec AC-5, AC-6; threat R53, R54, R64): a /b submit when a
// deposit applies. The booking is held awaiting_deposit and the diner gets
// the /p redirect; no "received" message until the paid event. A provider
// failure leaves no booking in the seat counts and a fixed code. No client
// amount is ever accepted.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { submitBookingRequest, type SubmitBookingDeps } from '../submit-booking-request'
import { FakeBookingRequests, FakeBookingSender, FakeBookingSettings, FakeBookingTokens } from '@/test-utils/fake-booking'
import { FakeRateLimiter } from '@/test-utils/fake-rate-limiter'
import { FakeClock } from '@/test-utils/fake-clock'
import { APP_URL, PER_GUEST_100, RESTAURANT, paymentWorld } from '@/test-utils/payment-world'
import { DEPOSIT_RULE_OFF } from '@/domain/value-objects/deposit-rule'

const PHONE = '+85291234567'
const TOKEN = 'A'.repeat(43)
const NOW = new Date('2026-12-01T02:00:00.000Z') // 10:00 in Hong Kong
const BODY = { date: '2026-12-24', time: '19:00', partySize: 4, name: 'Chan Tai Man', notes: 'nut allergy' }

let w: ReturnType<typeof paymentWorld>
let tokens: FakeBookingTokens
let requests: FakeBookingRequests
let settings: FakeBookingSettings
let sender: FakeBookingSender
let deps: SubmitBookingDeps

beforeEach(() => {
  vi.restoreAllMocks()
  w = paymentWorld(NOW)
  tokens = new FakeBookingTokens()
  tokens.add({ token: TOKEN, restaurantId: RESTAURANT, phone: PHONE, expiresAt: '2026-12-02T02:00:00.000Z' })
  requests = new FakeBookingRequests()
  settings = new FakeBookingSettings()
  settings.setConfig(RESTAURANT, { mode: 'simple', deposit: PER_GUEST_100 })
  settings.restaurants.set(RESTAURANT, { name: 'Café A', logoUrl: null, whatsappNumber: '+85220000001' })
  sender = new FakeBookingSender()
  const clock = new FakeClock(NOW)
  deps = {
    tokens, requests, settings, sender, limiter: new FakeRateLimiter(clock), now: () => clock.now(),
    members: { findMemberId: async () => null },
    deposit: { accounts: w.accounts, writer: w.ledger, start: w.startDeps },
  }
})

const submit = (body: unknown = BODY) => submitBookingRequest(deps, { token: TOKEN, body, clientIp: '203.0.113.7' })
const onlyBooking = () => [...w.ledger.bookings.values()][0]

describe('W3 AC-5: deposit applies -> held awaiting_deposit, redirect to /p, no received message yet', () => {
  it('returns the /p redirect built on the app URL; the booking holds its seats; nothing is sent', async () => {
    const result = await submit()
    expect(result).toEqual({ ok: true, bookingId: onlyBooking().id, redirect: `${APP_URL}/p/${w.tokens[0]}` })
    expect(onlyBooking()).toMatchObject({ status: 'awaiting_deposit', restaurantId: RESTAURANT, phone: PHONE, partySize: 4, source: 'chat' })
    expect(w.ledger.guests('2026-12-24', '19:00')).toBe(4)
    expect([...w.ledger.deposits.values()][0]).toMatchObject({ status: 'awaiting', amount: { amountMinor: 40000, currency: 'HKD' } })
    expect(sender.sent).toEqual([])
    expect(requests.rows).toEqual([])
  })

  it('the /b token stays spent after the submit (no second booking from the same link)', async () => {
    await submit()
    expect(await submit()).toEqual({ ok: false, reason: 'token_unusable', state: 'consumed' })
    expect(w.ledger.bookings.size).toBe(1)
  })
})

describe('W3: not_required -> the BOOK-001 path unchanged (pending + received message)', () => {
  it('party below the rule minimum: pending booking, received message, no deposit', async () => {
    settings.setConfig(RESTAURANT, { mode: 'simple', deposit: { ...PER_GUEST_100, fromPartySize: 6 } })
    const result = await submit()
    expect(result).toEqual({ ok: true, bookingId: requests.rows[0].id, delivered: true })
    expect(requests.rows[0].status).toBe('pending')
    expect(sender.sent.map((m) => m.kind)).toEqual(['received'])
    expect(w.ledger.deposits.size).toBe(0)
  })

  it('rule off: the account is not even read', async () => {
    settings.setConfig(RESTAURANT, { mode: 'simple', deposit: DEPOSIT_RULE_OFF })
    const find = vi.spyOn(w.accounts, 'findForRestaurant')
    expect((await submit()).ok).toBe(true)
    expect(find).not.toHaveBeenCalled()
    expect(requests.rows).toHaveLength(1)
  })

  it('AC-4: account not chargeable -> booking taken without a deposit', async () => {
    w.accounts.set({ restaurantId: RESTAURANT, status: 'restricted', chargesEnabled: false })
    const result = await submit()
    expect(result).toMatchObject({ ok: true, delivered: true })
    expect(requests.rows).toHaveLength(1)
    expect(w.ledger.deposits.size).toBe(0)
  })

  it('no deposit deps wired (BOOK-001 callers) -> pending as before', async () => {
    delete deps.deposit
    expect((await submit()).ok).toBe(true)
    expect(requests.rows).toHaveLength(1)
  })
})

describe('W3 R54 / R64: provider failure at submit', () => {
  it('503 code payment_unavailable; the hold is released (no seats counted); nothing is sent', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    w.gateway.failNext('createHostedPayment')
    expect(await submit()).toEqual({ ok: false, reason: 'payment_unavailable' })
    expect(onlyBooking().status).toBe('lapsed')
    expect(w.ledger.guests('2026-12-24', '19:00')).toBe(0)
    expect(sender.sent).toEqual([])
  })

  it('an account read that throws is a plain failure and re-arms the link', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(w.accounts, 'findForRestaurant').mockRejectedValueOnce(new Error('db down acct_secret_123'))
    expect(await submit()).toEqual({ ok: false, reason: 'failed' })
    expect(tokens.rows[0].consumedAt).toBeNull()
  })
})

describe('W3: the insert refuses (existing error mapping)', () => {
  it('per-phone cap reached at the atomic insert -> too_many_pending, link re-armed', async () => {
    for (let i = 0; i < 3; i++) {
      await w.ledger.insertWithDeposit(
        { ...w.request(), phone: PHONE, bookingTime: `1${i}:00` },
        { periodKey: null, periodFirst: null, periodLast: null, perSlot: null, perMeal: null },
        { id: `d${i}`, providerCode: 'test', accountId: w.account.id, providerAccountId: w.account.providerAccountId!, amount: { amountMinor: 100, currency: 'HKD' }, holdExpiresAt: '2026-12-01T03:00:00Z', linkTokenHash: `h${i}` },
        null
      )
    }
    expect(await submit()).toEqual({ ok: false, reason: 'too_many_pending' })
    expect(tokens.rows[0].consumedAt).toBeNull()
  })

  it('slot full at the atomic insert -> invalid full, link re-armed', async () => {
    w.ledger.defaultSlotLimit = 2
    const result = await submit()
    expect(result).toMatchObject({ ok: false, reason: 'invalid', errors: { time: 'full' } })
    expect(tokens.rows[0].consumedAt).toBeNull()
    expect(w.ledger.deposits.size).toBe(0)
  })
})

describe('W3 R53: no amount from the client', () => {
  it.each([{ amount: 1 }, { deposit: 0 }, { depositAmount: 1 }, { price: 1 }])('a body with %o is invalid; nothing written', async (extra) => {
    const result = await submit({ ...BODY, ...extra })
    expect(result).toMatchObject({ ok: false, reason: 'invalid' })
    expect(w.ledger.bookings.size).toBe(0)
    expect(requests.rows).toHaveLength(0)
    expect(tokens.rows[0].consumedAt).toBeNull()
  })

  it('the amount comes only from the stored rule (per guest 100 x 4 = HK$400)', async () => {
    await submit({ ...BODY, partySize: 4 })
    expect([...w.ledger.deposits.values()][0].amount).toEqual({ amountMinor: 40000, currency: 'HKD' })
  })
})

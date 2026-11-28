// BOOK-014 W5 (spec AC-10; threat R54, R59, R61, R62, R64): a personal
// agent's booking when the restaurant asks a deposit. Create is unchanged
// (unverified + code); the diner's code holds it awaiting_deposit through W1's
// startDeposit, the payment link goes to that WhatsApp chat, and the status
// read shows awaiting_deposit with payment_url + deposit{}. Paid -> pending,
// lapse -> expired. Runs on the in-repo test provider adapter (spec AC-16).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FakeBookingSender, FakeBookingSettings } from '@/test-utils/fake-booking'
import { FakeRateLimiter } from '@/test-utils/fake-rate-limiter'
import { FakeClock } from '@/test-utils/fake-clock'
import { paymentWorld, APP_URL } from '@/test-utils/payment-world'
import type { DepositRule } from '@/domain/value-objects/deposit-rule'
import { PAYMENT_UNAVAILABLE_TEXT } from '@/domain/value-objects/deposit-messages'
import { TEST_PAY_HOST } from '@/infrastructure/payments/test/test-gateway'
import { createAgentBooking, type CreateAgentBookingDeps } from '../create-agent-booking'
import { verifyAgentBooking, type VerifyAgentBookingDeps } from '../verify-agent-booking'
import { getAgentBookingStatus } from '../get-agent-booking-status'
import { agentAndStaffPaidHook } from '@/application/payments/notify-agent-deposit-paid'
import { processPaymentWebhook } from '@/application/payments/process-payment-webhook'
import { expireDeposits } from '@/application/payments/expire-deposits'
import { FakeAgentBookingStore, FakeAgentDirectory, scriptedSecrets } from './fake-agent-booking'

const R = 'rest-a'
const PID = 'A'.repeat(32)
const PHONE = '+85291234567'
const BODY = { date: '2026-11-20', time: '19:30', party_size: 4, name: 'Chan Tai Man', phone: PHONE }
const RULE: DepositRule = {
  enabled: true, mode: 'per_guest', amount: 100, fromPartySize: 2,
  refundNote: { zh_hk: '取消須提前24小時通知。', en: 'Cancel 24 hours ahead for a refund.' },
}

let clock: FakeClock
let store: FakeAgentBookingStore
let settings: FakeBookingSettings
let sender: FakeBookingSender
let directory: FakeAgentDirectory
let pay: ReturnType<typeof paymentWorld>
let texts: string[]
let createDeps: CreateAgentBookingDeps
let verifyDeps: VerifyAgentBookingDeps

function world(rule: DepositRule | null = RULE) {
  clock = new FakeClock(new Date('2026-11-19T02:00:00.000Z'))
  pay = paymentWorld(new Date('2026-11-19T02:00:00.000Z'))
  store = new FakeAgentBookingStore()
  store.createdAt = () => clock.now()
  directory = new FakeAgentDirectory()
  settings = new FakeBookingSettings()
  settings.configs.set(R, directory.add(R, PID, rule ? { deposit: rule } : {}))
  settings.restaurants.set(R, { name: 'Cafe A', logoUrl: null, whatsappNumber: '+85230001111' })
  sender = new FakeBookingSender()
  texts = []
  createDeps = {
    directory, store, settings, limiter: new FakeRateLimiter(clock), secrets: scriptedSecrets(['K7PX3M']),
    privacyUrl: 'https://p', now: () => clock.now(),
  }
  verifyDeps = {
    store, members: { findMemberId: async () => null }, settings, sender,
    sendText: async (_r, _p, text) => void texts.push(text),
    privacyUrl: 'https://p', now: () => clock.now(),
    deposit: { accounts: pay.accounts, start: pay.startDeps, promoter: store.depositPromoter(pay.ledger) },
  }
}

beforeEach(() => world())

async function create(body: Record<string, unknown> = BODY) {
  const result = await createAgentBooking(createDeps, { publicId: PID, body, clientIp: '1.1.1.1', idempotencyKey: null })
  if (!result.ok || result.kind !== 'awaiting_confirmation') throw new Error('create failed')
  return result.body
}

const verify = () => verifyAgentBooking(verifyDeps, { restaurantId: R, phone: PHONE, text: '確認訂座: K7PX3M', wamid: 'wamid.1' })

const status = (id: string, token: string) =>
  getAgentBookingStatus(
    { directory, store, now: () => clock.now(), deposits: { store: pay.ledger, registry: pay.registry } },
    { publicId: PID, bookingId: id, statusToken: token }
  )

const paidHook = () => agentAndStaffPaidHook({ settings, sender, recordMessage: async () => {} })

describe('AC-10 PAP: the code step with a deposit', () => {
  it('create is unchanged: unverified + confirm code, no deposit yet', async () => {
    const created = await create()
    expect(created).toMatchObject({ status: 'awaiting_confirmation', confirm_code: 'K7PX3M' })
    expect(pay.ledger.deposits.size).toBe(0)
  })

  it('verify -> awaiting_deposit with its deposit; the link message in that chat; no "received" yet', async () => {
    const created = await create()
    expect(await verify()).toEqual({ handled: true })

    const row = store.rows.find((r) => r.id === created.booking_id)!
    expect(row).toMatchObject({ status: 'awaiting_deposit', confirmCode: null, verifiedWamid: 'wamid.1' })
    const [deposit] = [...pay.ledger.deposits.values()]
    expect(deposit).toMatchObject({ bookingId: row.id, status: 'awaiting', amount: { amountMinor: 40000, currency: 'HKD' } })
    expect(pay.ledger.eventsOf(deposit.id)).toEqual(['created:system', 'session_created:system'])
    expect(sender.sent).toHaveLength(0)

    expect(texts).toHaveLength(1)
    const text = texts[0]
    expect(text).toContain('HK$400')
    expect(text).toContain('10:30') // 02:00Z + 30 min = 10:30 Hong Kong
    expect(text).toContain(`${APP_URL}/p/${pay.tokens[0]}`)
    expect(text).toContain('訂金由 Stripe 代Cafe A處理，Stripe 或會在香港以外地方處理你的付款資料。')
    expect(text).toContain('The deposit is processed by Stripe for Cafe A; Stripe may process your payment details outside Hong Kong.')
    expect(text).toContain('Cancel 24 hours ahead for a refund.')
    expect(text).toContain('私隱政策 Privacy policy: https://p')
  })

  it('status: awaiting_deposit + payment_url (provider host only) + deposit{amount, currency, expires_at}', async () => {
    const created = await create()
    await verify()
    const read = await status(created.booking_id, created.status_token)
    const [deposit] = [...pay.ledger.deposits.values()]
    expect(read).toEqual({
      ok: true,
      view: {
        booking_id: created.booking_id, status: 'awaiting_deposit', date: '2026-11-20', time: '19:30', party_size: 4,
        payment_url: deposit.sessionUrl,
        deposit: { amount: '400', currency: 'HKD', expires_at: deposit.holdExpiresAt },
      },
    })
    expect(new URL(deposit.sessionUrl!).hostname).toBe(TEST_PAY_HOST)

    // R62: a stored URL on any other host is never handed out.
    pay.ledger.deposits.get(deposit.id)!.sessionUrl = 'https://evil.example/pay'
    const again = await status(created.booking_id, created.status_token)
    expect(again.ok && again.view).not.toHaveProperty('payment_url')
    expect(again.ok && again.view.deposit).toEqual({ amount: '400', currency: 'HKD', expires_at: deposit.holdExpiresAt })
  })

  it('paid (signed webhook) -> pending as today, and the "received" message once', async () => {
    const created = await create()
    await verify()
    const [deposit] = [...pay.ledger.deposits.values()]
    const delivery = pay.gateway.completeSession(deposit.providerSessionId!)
    await processPaymentWebhook({ ...pay.webhookDeps, onDepositPaid: paidHook() }, delivery)
    await processPaymentWebhook({ ...pay.webhookDeps, onDepositPaid: paidHook() }, delivery)
    const read = await status(created.booking_id, created.status_token)
    expect(read).toMatchObject({ ok: true, view: { status: 'pending' } })
    expect(read.ok && read.view).not.toHaveProperty('deposit')
    expect(read.ok && read.view).not.toHaveProperty('payment_url')
    expect(sender.sent.map((m) => m.kind)).toEqual(['received'])
  })

  it('no payment in 30 minutes -> lapsed, which the agent reads as expired; seats freed', async () => {
    const created = await create()
    await verify()
    pay.advance(31 * 60_000)
    expect((await expireDeposits(pay.expireDeps)).depositsLapsed).toBe(1)
    expect(await status(created.booking_id, created.status_token)).toMatchObject({ ok: true, view: { status: 'expired' } })
    expect(pay.ledger.guests('2026-11-20', '19:30', R)).toBe(0)
  })

  it('payment_unavailable: fixed code, fixed diner text, no booking keeps seats, no provider detail (R54, R64)', async () => {
    const created = await create()
    vi.spyOn(pay.gateway, 'createHostedPayment').mockRejectedValueOnce(new Error('No such account: acct_test_A (req_9)'))
    const result = await verify()
    expect(result).toEqual({ handled: true, error: 'payment_unavailable' })
    expect(texts).toEqual([PAYMENT_UNAVAILABLE_TEXT])
    expect(texts.join()).not.toMatch(/acct_|req_9|No such account/)
    expect(pay.ledger.guests('2026-11-20', '19:30', R)).toBe(0)
    const read = await status(created.booking_id, created.status_token)
    expect(read).toMatchObject({ ok: true, view: { status: 'expired' } })
    expect(JSON.stringify(read)).not.toMatch(/acct_|req_9/)
  })

  it('a replayed code after the hold changes nothing (no second deposit, no second text)', async () => {
    await create()
    await verify()
    expect(await verify()).toEqual({ handled: false })
    expect(pay.ledger.deposits.size).toBe(1)
    expect(texts).toHaveLength(1)
  })

  it('without a deposit (rule off, or party below N): pending + "received" as today', async () => {
    for (const [rule, body] of [[null, BODY], [RULE, { ...BODY, party_size: 1 }]] as const) {
      world(rule)
      const created = await create(body)
      expect(await verify()).toEqual({ handled: true })
      expect(store.rows.find((r) => r.id === created.booking_id)?.status).toBe('pending')
      expect(pay.ledger.deposits.size).toBe(0)
      expect(sender.sent.map((m) => m.kind)).toEqual(['received'])
      expect(await status(created.booking_id, created.status_token)).toMatchObject({ ok: true, view: { status: 'pending' } })
    }
  })

  it('R59: the create API rejects a deposit or amount field (unknown_field), nothing written', async () => {
    const result = await createAgentBooking(createDeps, {
      publicId: PID, body: { ...BODY, deposit: false, amount: 0 }, clientIp: '1.1.1.1', idempotencyKey: null,
    })
    expect(result).toMatchObject({ ok: false, reason: 'invalid', errors: { deposit: 'unknown_field', amount: 'unknown_field' } })
    expect(store.rows).toHaveLength(0)
  })
})

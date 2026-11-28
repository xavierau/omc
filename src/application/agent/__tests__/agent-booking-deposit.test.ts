// BOOK-014 W5 (spec AC-9, Q5, Explicitly Not Handled; threat R59, R61, R64):
// deposits on the WhatsApp AI agent's booking tools, through W1's startDeposit,
// the in-repo test provider adapter and the deposit ledger (payment-world.ts,
// spec AC-16). FakeClock: 2026-11-19T10:00Z = Thu 18:00 in Hong Kong; each job() is +1 min.
import { describe, it, expect, vi } from 'vitest'
import { createAgentToolExecutor } from '@/application/agent/agent-tools'
import { AGENT_TOOL_DECLARATIONS } from '@/application/agent/agent-tools'
import { AGENT_TOOL_NAMES, DEFAULT_DISCLOSURE_TEXT } from '@/domain/value-objects/agent-config'
import type { BookingConfig } from '@/domain/value-objects/booking-config'
import type { DepositRule } from '@/domain/value-objects/deposit-rule'
import { agentAndStaffPaidHook } from '@/application/payments/notify-agent-deposit-paid'
import { processPaymentWebhook } from '@/application/payments/process-payment-webhook'
import { expireDeposits } from '@/application/payments/expire-deposits'
import { FakeAgentStore, FakeClock, fakeBookingWorld, fakeToolData } from '@/application/__tests__/agent-fakes'
import { APP_URL, paymentWorld } from '@/test-utils/payment-world'

const R = 'rest-a'
const PHONE = '+85291234567'
const KEY = { restaurantId: R, phone: PHONE }
const DAY = '2026-11-21'
const GOOD = { date: DAY, time: '19:00', partySize: 4, name: '陳生' }
const RULE: DepositRule = {
  enabled: true, mode: 'per_guest', amount: 100, fromPartySize: 2,
  refundNote: { zh_hk: '取消須提前24小時通知。', en: 'Cancel 24 hours ahead for a refund.' },
}

function setup(patch: Partial<BookingConfig> = { deposit: RULE }) {
  const clock = new FakeClock()
  const store = new FakeAgentStore(clock)
  const world = fakeBookingWorld(clock)
  const pay = paymentWorld(new Date(clock.ms))
  world.settings.setConfig(R, { mode: 'simple', maxPartySize: 8, ...patch })
  world.settings.restaurants.set(R, { name: 'Café A', logoUrl: null, whatsappNumber: null })

  async function job() {
    world.proposals.deliverAll()
    clock.advance(60_000)
    const row = store.seed({ restaurant_id: R, phone: PHONE, role: 'user', text: 'msg' })
    const { getConfig, ...ports } = world.deps
    return createAgentToolExecutor({
      key: KEY, enabledTools: [...AGENT_TOOL_NAMES], handoffSilenceHours: 12, now: clock.now, data: fakeToolData(),
      silences: store, agentMode: 'auto',
      booking: {
        ...ports, config: await getConfig(R), inboundCreatedAt: () => store.userMessageCreatedAt(KEY, row.id),
        proposalOwner: `run-${row.id}`, disclosureText: DEFAULT_DISCLOSURE_TEXT,
        deposit: { accounts: pay.accounts, writer: pay.ledger, start: pay.startDeps, deposits: pay.ledger },
      },
    })
  }

  async function proposeAndCreate(body: Record<string, unknown> = GOOD) {
    const proposed = await (await job())('propose_booking', body)
    const created = await (await job())('create_booking_request', {})
    return { proposed, created }
  }

  /** A confirmed booking of this diner in the agent's store, with a deposit row in `status`. */
  async function bookingWithDeposit(status: 'paid' | 'lapsed' | 'awaiting' | 'refunded') {
    const booking = await world.requests.insert({
      restaurantId: R, memberId: null, phone: PHONE, name: '陳生', partySize: 4, bookingDate: DAY, bookingTime: '19:00',
      notes: null, source: 'agent', campaignId: null, token: null,
    })
    booking.status = 'confirmed'
    const hold = {
      id: crypto.randomUUID(), providerCode: 'test' as const, accountId: pay.account.id, providerAccountId: pay.account.providerAccountId!,
      amount: { amountMinor: 40000, currency: 'HKD' }, holdExpiresAt: new Date(clock.ms + 30 * 60_000).toISOString(), linkTokenHash: 'h'.repeat(64),
    }
    const deposit = pay.ledger.adoptHold(booking, hold, 'u-1')
    pay.ledger.deposits.get(deposit.id)!.status = status
    return booking
  }

  const agentHolds = () => [...pay.ledger.bookings.values()].filter((b) => b.source === 'agent')
  return { world, pay, job, proposeAndCreate, bookingWithDeposit, agentHolds }
}

describe('AC-9 create_booking_request with a deposit', () => {
  it('propose reads the deposit back: amount, 30 minutes, the refund rule', async () => {
    const { proposeAndCreate } = setup()
    const { proposed } = await proposeAndCreate()
    expect(proposed).toMatchObject({ proposed: true, deposit: { amount: 'HK$400', payWithinMinutes: 30, terms: 'Deposit HK$100 per guest for 2 or more. Cancel 24 hours ahead for a refund.' } })
    expect(String(proposed.note)).toContain('deposit of HK$400')
  })

  it('held awaiting_deposit with its seats; the diner gets amount, hold end, /p link and the Stripe sentence; no "received" yet', async () => {
    const { world, pay, proposeAndCreate, agentHolds } = setup()
    const { created } = await proposeAndCreate()

    const [held] = agentHolds()
    expect(held).toMatchObject({ status: 'awaiting_deposit', partySize: 4, bookingDate: DAY, bookingTime: '19:00', phone: PHONE })
    expect(world.requests.rows.filter((r) => r.source === 'agent')).toHaveLength(0) // not a pending request
    expect(pay.ledger.guests(DAY, '19:00', R)).toBe(4)

    const link = `${APP_URL}/p/${pay.tokens[0]}`
    expect(created).toMatchObject({ booked: true, status: 'awaiting_deposit', deposit: { amount: 'HK$400', payBy: '18:30', paymentUrl: link } })
    expect(world.texts).toHaveLength(1)
    const text = world.texts[0].text
    expect(text).toContain('HK$400')
    expect(text).toContain('18:30')
    expect(text).toContain(link)
    expect(text).toContain('訂金由 Stripe 代Café A處理，Stripe 或會在香港以外地方處理你的付款資料。')
    expect(text).toContain('The deposit is processed by Stripe for Café A; Stripe may process your payment details outside Hong Kong.')
    expect(text).toContain('Cancel 24 hours ahead for a refund.')
    expect(text.endsWith(DEFAULT_DISCLOSURE_TEXT)).toBe(true)
    expect(world.sender.sent.filter((m) => m.kind === 'received')).toHaveLength(0)
  })

  it('paid (signed webhook) -> pending + the "received" message once; a lapse instead -> lapsed', async () => {
    const { world, pay, proposeAndCreate, agentHolds } = setup()
    await proposeAndCreate()
    const deposit = [...pay.ledger.deposits.values()][0]
    const hook = agentAndStaffPaidHook({ settings: world.settings, sender: world.sender, recordMessage: async () => {} })
    const deliver = (d: Parameters<typeof processPaymentWebhook>[1]) => processPaymentWebhook({ ...pay.webhookDeps, onDepositPaid: hook }, d)

    const delivery = pay.gateway.completeSession(deposit.providerSessionId!)
    await deliver(delivery)
    await deliver(delivery)
    expect(agentHolds()[0].status).toBe('pending')
    expect(world.sender.sent.filter((m) => m.kind === 'received')).toHaveLength(1)

    const other = setup()
    await other.proposeAndCreate()
    other.pay.advance(31 * 60_000)
    await expireDeposits(other.pay.expireDeps)
    expect(other.agentHolds()[0].status).toBe('lapsed')
    expect(other.pay.ledger.guests(DAY, '19:00', R)).toBe(0)
  })

  it('no deposit (rule off, or party below N): unchanged, a pending request and the "received" message', async () => {
    for (const patch of [{}, { deposit: RULE }]) {
      const { world, proposeAndCreate, agentHolds, pay } = setup(patch)
      const body = 'deposit' in patch ? { ...GOOD, partySize: 1 } : GOOD
      const { proposed, created } = await proposeAndCreate(body)
      expect(proposed).not.toHaveProperty('deposit')
      expect(created).toMatchObject({ booked: true, status: 'pending' })
      expect(agentHolds()).toHaveLength(0)
      expect(pay.gateway.calls.createHostedPayment).toBe(0)
      expect(world.requests.rows.filter((r) => r.source === 'agent' && r.status === 'pending')).toHaveLength(1)
      expect(world.sender.sent.filter((m) => m.kind === 'received')).toHaveLength(1)
    }
  })

  it('payment_unavailable: the fixed answer, no booking keeps seats, no provider text (R54, R64)', async () => {
    const { pay, proposeAndCreate, agentHolds, world } = setup()
    vi.spyOn(pay.gateway, 'createHostedPayment').mockRejectedValueOnce(new Error('No such account: acct_test_A (req_123)'))
    const { created } = await proposeAndCreate()
    expect(created).toEqual({
      error: 'payment_unavailable',
      note: 'The deposit payment is unavailable right now, so nothing was booked. Tell the diner payment is unavailable right now and to message the restaurant.',
    })
    expect(JSON.stringify(created)).not.toMatch(/acct_|req_123|No such account/)
    expect(agentHolds().map((b) => b.status)).toEqual(['lapsed'])
    expect(pay.ledger.guests(DAY, '19:00', R)).toBe(0)
    expect(world.texts).toHaveLength(0)
  })

  it('account not Active: taken without a deposit (spec AC-4)', async () => {
    const { pay, proposeAndCreate, agentHolds } = setup()
    pay.accounts.set({ restaurantId: R, chargesEnabled: false })
    const { proposed, created } = await proposeAndCreate()
    expect(proposed).not.toHaveProperty('deposit')
    expect(created).toMatchObject({ booked: true, status: 'pending' })
    expect(agentHolds()).toHaveLength(0)
  })

  it('the hold write refuses at the per-phone cap: too_many_pending, nothing charged', async () => {
    const { pay, proposeAndCreate } = setup()
    for (let i = 0; i < 3; i++) await pay.ledger.insertWithDeposit(pay.request({ restaurantId: R, phone: PHONE, partySize: 2 }), { periodKey: null, periodFirst: null, periodLast: null, perSlot: null, perMeal: null }, { ...(await holdFor(pay, i)) }, null)
    const { created } = await proposeAndCreate()
    expect(created).toMatchObject({ error: 'too_many_pending' })
    expect(pay.gateway.calls.createHostedPayment).toBe(0)
  })
})

async function holdFor(pay: ReturnType<typeof paymentWorld>, i: number) {
  return {
    id: crypto.randomUUID(), providerCode: 'test' as const, accountId: pay.account.id, providerAccountId: pay.account.providerAccountId!,
    amount: { amountMinor: 20000, currency: 'HKD' }, holdExpiresAt: new Date(Date.now() + 60_000).toISOString(), linkTokenHash: String(i).repeat(64),
  }
}

describe('R59: no deposit, amount, waiver, refund or payment field on any AI tool', () => {
  it('schema snapshot: no declared parameter names money or payment', () => {
    const params = Object.values(AGENT_TOOL_DECLARATIONS).flatMap((d) => Object.keys(d.parameters?.properties ?? {}))
    expect(params.filter((p) => /deposit|amount|waiv|refund|pay|paid|price|currency|charge/i.test(p))).toEqual([])
    expect(AGENT_TOOL_DECLARATIONS.create_booking_request.parameters).toBeUndefined()
  })

  it('an injected deposit:false / amount on create or propose is refused before anything runs', async () => {
    const { job, world, pay, agentHolds } = setup()
    const injected = await (await job())('propose_booking', { ...GOOD, deposit: false, amount: 0 })
    expect(injected).toMatchObject({ error: 'invalid', fields: { deposit: 'not_allowed', amount: 'not_allowed' } })
    await (await job())('propose_booking', GOOD)
    const create = await (await job())('create_booking_request', { waiveDeposit: true, paymentStatus: 'paid' })
    expect(create).toMatchObject({ error: 'invalid', fields: { waiveDeposit: 'not_allowed', paymentStatus: 'not_allowed' } })
    expect(agentHolds()).toHaveLength(0)
    expect(world.requests.rows.filter((r) => r.source === 'agent')).toHaveLength(0)
    expect(pay.gateway.calls.createHostedPayment).toBe(0)
  })
})

describe('Explicitly Not Handled: the change tools refuse a booking with a deposit', () => {
  it.each(['paid', 'awaiting', 'refunded'] as const)('deposit %s -> propose and confirm change refuse with the fixed text', async (status) => {
    const { job, bookingWithDeposit, world } = setup()
    const booking = await bookingWithDeposit(status)
    const ref = booking.id.slice(0, 8)
    const out = await (await job())('propose_booking_change', { bookingRef: ref, time: '20:00' })
    expect(out).toEqual({
      error: 'deposit_booking',
      note: 'This booking has a deposit, so it cannot be changed in chat. Tell the diner the restaurant staff will help them change it, and offer handoff_to_staff if you have it.',
    })
    expect(world.requests.rows.filter((r) => r.replacesBookingId === booking.id)).toHaveLength(0)
  })

  it('a deposit that came after the proposal is refused at confirm', async () => {
    const { job, world, pay } = setup({})
    const booking = await world.requests.insert({
      restaurantId: R, memberId: null, phone: PHONE, name: '陳生', partySize: 4, bookingDate: DAY, bookingTime: '19:00',
      notes: null, source: 'agent', campaignId: null, token: null,
    })
    booking.status = 'confirmed'
    expect(await (await job())('propose_booking_change', { bookingRef: booking.id.slice(0, 8), time: '20:00' })).toMatchObject({ proposed: true })
    pay.ledger.adoptHold(booking, await holdFor(pay, 7), 'u-1')
    expect(await (await job())('confirm_booking_change', {})).toMatchObject({ error: 'deposit_booking' })
  })

  it('a lapsed deposit does not block a change', async () => {
    const { job, bookingWithDeposit } = setup()
    const booking = await bookingWithDeposit('lapsed')
    expect(await (await job())('propose_booking_change', { bookingRef: booking.id.slice(0, 8), time: '20:00' })).toMatchObject({ proposed: true })
  })
})

describe('Q5: diner cancel of a booking with a paid deposit', () => {
  it('cancelled; the read-back and the text say the restaurant decides, quoting the refund rule', async () => {
    const { job, bookingWithDeposit, world, pay } = setup()
    const booking = await bookingWithDeposit('paid')
    const proposed = await (await job())('propose_booking_cancel', { bookingRef: booking.id.slice(0, 8) })
    expect(String(proposed.depositNote)).toContain('The restaurant will decide on your HK$400 deposit.')
    const done = await (await job())('confirm_booking_cancel', {})
    expect(done).toMatchObject({ cancelled: true })
    expect(world.requests.rows.find((r) => r.id === booking.id)?.status).toBe('cancelled')
    const text = world.texts.at(-1)!.text
    expect(text).toContain('已取消')
    expect(text).toContain('你已付的訂金 HK$400 會由餐廳決定是否退回。')
    expect(text).toContain('訂金每位 HK$100（2位或以上）。取消須提前24小時通知。')
    expect(text).toContain('The restaurant will decide on your HK$400 deposit.')
    expect(text).toContain('Deposit HK$100 per guest for 2 or more. Cancel 24 hours ahead for a refund.')
    // Staff then Refund / Keep (W4): the deposit stays paid, no refund was started by the agent.
    expect([...pay.ledger.deposits.values()][0].status).toBe('paid')
    expect(pay.gateway.calls.refund).toBe(0)
  })

  it('without a paid deposit the cancel text is unchanged', async () => {
    const { job, bookingWithDeposit, world } = setup()
    const booking = await bookingWithDeposit('lapsed')
    await (await job())('propose_booking_cancel', { bookingRef: booking.id.slice(0, 8) })
    await (await job())('confirm_booking_cancel', {})
    expect(world.texts.at(-1)!.text).not.toContain('HK$400')
  })
})

// BOOK-014 W6-fix F5 (PR #237 /code-review): propose and create must agree on
// the deposit. The proposal stores the planned deposit; create recomputes it
// and, when it changed, books nothing, charges nothing and re-proposes.
describe('W6-fix F5: the deposit terms changed between propose and create', () => {
  const CHANGED_NOTE = 'The deposit terms changed since the diner agreed, so nothing was booked.'

  it('F5 plan changed (deposit -> none: account no longer chargeable) -> refusal + re-propose, no hold, no booking; the next create books without a deposit', async () => {
    const { world, pay, job, agentHolds } = setup()
    const proposed = await (await job())('propose_booking', GOOD)
    expect(proposed).toMatchObject({ deposit: { amount: 'HK$400' } })
    pay.accounts.set({ restaurantId: R, chargesEnabled: false })

    const refused = await (await job())('create_booking_request', {})
    expect(refused).toMatchObject({ error: 'deposit_terms_changed', proposed: true, booking: { partySize: 4, date: DAY, time: '19:00' } })
    expect(refused).not.toHaveProperty('deposit')
    expect(String(refused.note)).toContain(CHANGED_NOTE)
    expect(String(refused.note)).toContain('no deposit is needed now')
    expect(agentHolds()).toHaveLength(0)
    expect(world.requests.rows.filter((r) => r.source === 'agent')).toHaveLength(0)
    expect(pay.gateway.calls.createHostedPayment).toBe(0)
    expect(world.texts).toHaveLength(0)

    // The diner agrees to the new proposal in a later message.
    expect(await (await job())('create_booking_request', {})).toMatchObject({ booked: true, status: 'pending' })
    expect(agentHolds()).toHaveLength(0)
  })

  it('F5 plan changed (none -> deposit: the rule was switched on) -> refusal with the new amount, no plain booking; the next create holds it', async () => {
    const { world, pay, job, agentHolds } = setup({})
    const proposed = await (await job())('propose_booking', GOOD)
    expect(proposed).not.toHaveProperty('deposit')
    world.settings.setConfig(R, { mode: 'simple', maxPartySize: 8, deposit: RULE })

    const refused = await (await job())('create_booking_request', {})
    expect(refused).toMatchObject({ error: 'deposit_terms_changed', proposed: true, deposit: { amount: 'HK$400', payWithinMinutes: 30 } })
    expect(String(refused.note)).toContain(CHANGED_NOTE)
    expect(world.requests.rows.filter((r) => r.source === 'agent')).toHaveLength(0)
    expect(world.sender.sent.filter((m) => m.kind === 'received')).toHaveLength(0)
    expect(pay.gateway.calls.createHostedPayment).toBe(0)

    expect(await (await job())('create_booking_request', {})).toMatchObject({ booked: true, status: 'awaiting_deposit', deposit: { amount: 'HK$400' } })
    expect(agentHolds()).toHaveLength(1)
  })

  it('F5 plan changed (amount) -> refusal quoting the new amount; same plan -> books as before', async () => {
    const { world, job, agentHolds } = setup()
    await (await job())('propose_booking', GOOD)
    world.settings.setConfig(R, { mode: 'simple', maxPartySize: 8, deposit: { ...RULE, amount: 150 } })
    const refused = await (await job())('create_booking_request', {})
    expect(refused).toMatchObject({ error: 'deposit_terms_changed', deposit: { amount: 'HK$600' } })
    expect(agentHolds()).toHaveLength(0)
    expect(await (await job())('create_booking_request', {})).toMatchObject({ booked: true, deposit: { amount: 'HK$600' } })
  })

  it('F5 a proposal stored before W6-fix (no planned deposit) is booked as today', async () => {
    const { world, job, agentHolds } = setup()
    await (await job())('propose_booking', GOOD)
    const entries = [...world.proposals.entries.values()]
    expect(entries).toHaveLength(1)
    expect(entries[0].proposal).toMatchObject({ plannedDeposit: { amountMinor: 40000, currency: 'HKD' } })
    delete (entries[0].proposal as { plannedDeposit?: unknown }).plannedDeposit
    expect(await (await job())('create_booking_request', {})).toMatchObject({ booked: true, status: 'awaiting_deposit' })
    expect(agentHolds()).toHaveLength(1)
  })
})

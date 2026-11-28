// BOOK-014 W1: one describe per threat mitigation, each the test the threat
// model's "Test that proves it" column names (threats/2026-11-27-book-014-
// booking-deposits). The route-level halves of R47/R48 (missing secret, 413)
// are in src/app/api/webhooks/payments/stripe/__tests__; R50's adapter half,
// R61 and R63 in src/infrastructure/payments; the SQL halves of R55-R58 in
// booking-deposits.db.test.ts.
import { describe, it, expect } from 'vitest'
import { processPaymentWebhook } from '../process-payment-webhook'
import { expireDeposits } from '../expire-deposits'
import { keepDeposit, refundDeposit, retryDepositRefund } from '../deposit-decisions'
import { resolvePaymentLink } from '../resolve-payment-link'
import { PaymentGatewayError } from '@/domain/ports/payment-gateway'
import { hashPaymentLinkToken } from '@/domain/services/payment-link-token'
import { OTHER_RESTAURANT, PER_GUEST_100, RESTAURANT, paymentWorld } from '@/test-utils/payment-world'
import { TEST_PAY_HOST } from '@/infrastructure/payments/test/test-gateway'

const STAFF = 'staff-user-1'
type World = ReturnType<typeof paymentWorld>

async function started(w: World, over: Parameters<World['book']>[0] = {}) {
  const r = await w.book(over)
  if (r.kind !== 'started') throw new Error(`expected started, got ${r.kind}`)
  return r
}

async function paidAndCancelled(w: World) {
  const s = await started(w)
  await w.deliver(w.gateway.completeSession(s.deposit.providerSessionId!))
  w.ledger.setBookingStatus(s.booking.id, 'cancelled')
  return s
}

describe('R48: signature first, idempotent by event id, claim released on failure', () => {
  it('replay of the same signed event twice -> one state change, second 200 duplicate', async () => {
    const w = paymentWorld()
    const s = await started(w)
    const delivery = w.gateway.completeSession(s.deposit.providerSessionId!)
    expect((await w.deliver(delivery)).body).toEqual({ received: true, outcomes: ['paid'] })
    expect((await w.deliver(delivery)).body).toEqual({ received: true, outcomes: ['duplicate'] })
    expect(w.ledger.eventsOf(s.deposit.id).filter((e) => e.startsWith('paid'))).toHaveLength(1)
  })

  it('handler throws -> claim released, 500, and the next delivery succeeds', async () => {
    const w = paymentWorld()
    const s = await started(w)
    const delivery = w.gateway.completeSession(s.deposit.providerSessionId!)
    w.ledger.failNext = 'markPaid'
    expect(await w.deliver(delivery)).toEqual({ status: 500, body: { error: 'processing_failed' } })
    expect(w.claims.releases).toHaveLength(1)
    expect(w.ledger.booking(s.booking.id)?.status).toBe('awaiting_deposit')
    expect((await w.deliver(delivery)).body).toEqual({ received: true, outcomes: ['paid'] })
    expect(w.ledger.booking(s.booking.id)?.status).toBe('pending')
  })

  it('a missing or wrong signature -> 400, nothing claimed or written; an idempotency outage -> 500', async () => {
    const w = paymentWorld()
    const s = await started(w)
    const delivery = w.gateway.completeSession(s.deposit.providerSessionId!)
    expect(await w.deliver({ rawBody: delivery.rawBody, headers: new Headers() })).toEqual({ status: 400, body: { error: 'invalid_signature' } })
    const tampered = delivery.rawBody.replace('"paid":true', '"paid":true ')
    expect((await w.deliver({ rawBody: tampered, headers: delivery.headers })).status).toBe(400)
    expect(w.claims.keys.size).toBe(0)
    w.claims.failNextClaim = true
    expect((await w.deliver(delivery)).status).toBe(500)
    expect(w.ledger.booking(s.booking.id)?.status).toBe('awaiting_deposit')
  })
})

describe('R49: a payment is matched only by OUR stored session id, and only when account, amount, currency and paid all match', () => {
  it('session id unknown -> no change, ignored and logged at info as an unrelated session (not a security event; review finding 7)', async () => {
    const w = paymentWorld()
    const s = await started(w)
    w.gateway.completeSession(s.deposit.providerSessionId!)
    const forged = w.gateway.signedEvent({
      id: 'evt_forged', type: 'session.completed', livemode: false, account: s.deposit.providerAccountId, session: 'sess_unknown',
      payment: 'pay_x', amount: 40000, currency: 'HKD', paid: true,
    })
    expect((await w.deliver(forged)).body).toEqual({ received: true, outcomes: ['ignored'] })
    expect(w.ledger.booking(s.booking.id)?.status).toBe('awaiting_deposit')
    expect(w.lines).toContainEqual({ level: 'info', event: 'payment.unrelated_session', data: { eventId: 'evt_forged', sessionRef: 'sess_unknown' } })
    expect(w.lines.filter((l) => l.event === 'payment.security_mismatch')).toEqual([])
  })

  it.each([
    ['a different account', { account: 'acct_attacker' }, 'account_mismatch'],
    ['amount - 1', { amount: 39999 }, 'amount_mismatch'],
    ['another currency', { currency: 'USD' }, 'amount_mismatch'],
  ])('same session id but %s -> no change', async (_label, override, reason) => {
    const w = paymentWorld()
    const s = await started(w)
    const out = await w.deliver(w.gateway.completeSession(s.deposit.providerSessionId!, override))
    expect(out.body).toEqual({ received: true, outcomes: ['rejected'] })
    expect(w.ledger.booking(s.booking.id)?.status).toBe('awaiting_deposit')
    expect(w.ledger.deposits.get(s.deposit.id)?.status).toBe('awaiting')
    expect(w.lines).toContainEqual(expect.objectContaining({ data: expect.objectContaining({ reason }) }))
  })

  it('payment_status not paid -> no change', async () => {
    const w = paymentWorld()
    const s = await started(w)
    expect((await w.deliver(w.gateway.completeSession(s.deposit.providerSessionId!, { paid: false }))).body).toEqual({ received: true, outcomes: ['ignored'] })
    expect(w.ledger.booking(s.booking.id)?.status).toBe('awaiting_deposit')
  })

  it('all match -> paid', async () => {
    const w = paymentWorld()
    const s = await started(w)
    expect((await w.deliver(w.gateway.completeSession(s.deposit.providerSessionId!))).body).toEqual({ received: true, outcomes: ['paid'] })
  })
  // "metadata booking id of another tenant with an unknown session": the Stripe adapter test
  // (infrastructure/payments/stripe/__tests__) delivers exactly that through this processor.
})

describe('R50: an event in the other mode is ignored', () => {
  it('livemode true while the adapter is in test mode -> no change, nothing claimed', async () => {
    const w = paymentWorld()
    const s = await started(w)
    const out = await w.deliver(w.gateway.completeSession(s.deposit.providerSessionId!, { livemode: true }))
    expect(out.body).toEqual({ received: true, outcomes: ['mode_mismatch'] })
    expect(w.claims.keys.size).toBe(0)
    expect(w.ledger.booking(s.booking.id)?.status).toBe('awaiting_deposit')
  })
})

describe('R53: the amount comes from the stored rule only', () => {
  it('startDeposit takes no amount: the session is created for rule × party, in the account currency', async () => {
    const w = paymentWorld()
    const s = await started(w, { partySize: 8 })
    expect(s.amount).toEqual({ amountMinor: 80000, currency: 'HKD' })
    expect(w.gateway.sessions.get(s.deposit.providerSessionId!)?.amount).toEqual({ amountMinor: 80000, currency: 'HKD' })
  })
  it('AC-4: rule off, party below N, or an account that cannot charge -> not_required, nothing written', async () => {
    const w = paymentWorld()
    expect((await w.book({}, { rule: { ...PER_GUEST_100, enabled: false } })).kind).toBe('not_required')
    expect((await w.book({ partySize: 2 }, { rule: { ...PER_GUEST_100, fromPartySize: 6 } })).kind).toBe('not_required')
    expect((await w.book({}, { account: { ...w.account, status: 'restricted' } })).kind).toBe('not_required')
    expect((await w.book({}, { account: null })).kind).toBe('not_required')
    expect(w.ledger.bookings.size).toBe(0)
    expect(w.gateway.calls.createHostedPayment).toBe(0)
  })
})

describe('R54: the provider fails at submit -> no booking remains in seat counts, payment_unavailable', () => {
  it('session create fails -> the booking and hold lapse in the same call; seats free', async () => {
    const w = paymentWorld()
    w.gateway.failNext('createHostedPayment')
    const r = await w.book()
    expect(r).toEqual({ kind: 'payment_unavailable' })
    expect(w.ledger.guests('2026-12-24', '19:00')).toBe(0)
    const [deposit] = [...w.ledger.deposits.values()]
    expect(deposit.status).toBe('lapsed')
    expect(w.ledger.eventsOf(deposit.id)).toEqual(['created:system', 'session_failed:system'])
  })
  it('storing the session fails -> hold released AND the orphan session closed', async () => {
    const w = paymentWorld()
    w.ledger.failNext = 'attachSession'
    expect(await w.book()).toEqual({ kind: 'payment_unavailable' })
    expect(w.ledger.guests('2026-12-24', '19:00')).toBe(0)
    expect([...w.gateway.sessions.values()][0].status).toBe('expired')
  })
  it('no provider configured -> payment_unavailable before anything is written', async () => {
    const w = paymentWorld()
    const r = await w.book({}, { account: { ...w.account, providerCode: 'stripe' } })
    expect(r).toEqual({ kind: 'payment_unavailable' })
    expect(w.ledger.bookings.size).toBe(0)
  })
  it('a seat or cap refusal passes through with nothing written to the provider', async () => {
    const w = paymentWorld()
    expect((await w.book({ partySize: 11 })).kind).toBe('refused')
    for (const n of [1, 2, 3]) expect((await w.book({ partySize: 1, name: `n${n}` })).kind).toBe('started')
    expect(await w.book({ partySize: 1 })).toEqual({ kind: 'refused', refusal: { kind: 'pending_cap' } })
    expect(w.gateway.calls.createHostedPayment).toBe(3)
  })
})

describe('R56: refund state machine with CAS', () => {
  it('two concurrent Refund calls -> one provider call', async () => {
    const w = paymentWorld()
    const s = await paidAndCancelled(w)
    const input = { restaurantId: RESTAURANT, bookingId: s.booking.id, actorUserId: STAFF, reason: 'staff' as const }
    const [a, b] = await Promise.all([refundDeposit(w.decisionDeps, input), refundDeposit(w.decisionDeps, input)])
    expect([a.ok, b.ok].sort()).toEqual([false, true])
    expect(w.gateway.calls.refund).toBe(1)
    expect([...w.gateway.refunds.values()][0].amount).toEqual({ amountMinor: 40000, currency: 'HKD' })
  })
  it('Refund after Keep -> conflict (409); Keep after Refund -> conflict (409)', async () => {
    const w = paymentWorld()
    const kept = await paidAndCancelled(w)
    expect((await keepDeposit(w.decisionDeps, { restaurantId: RESTAURANT, bookingId: kept.booking.id, actorUserId: STAFF })).ok).toBe(true)
    expect(await refundDeposit(w.decisionDeps, { restaurantId: RESTAURANT, bookingId: kept.booking.id, actorUserId: STAFF, reason: 'staff' })).toEqual({
      ok: false, reason: 'conflict', status: 'kept',
    })
    const w2 = paymentWorld()
    const refunded = await paidAndCancelled(w2)
    await refundDeposit(w2.decisionDeps, { restaurantId: RESTAURANT, bookingId: refunded.booking.id, actorUserId: STAFF, reason: 'staff' })
    expect(await keepDeposit(w2.decisionDeps, { restaurantId: RESTAURANT, bookingId: refunded.booking.id, actorUserId: STAFF })).toEqual({
      ok: false, reason: 'conflict', status: 'refunded',
    })
  })
  it('refund webhook succeeded -> refunded; failed -> refund_failed with Retry (a new idempotency key)', async () => {
    const w = paymentWorld()
    const s = await paidAndCancelled(w)
    w.gateway.refundOutcome = 'pending'
    await refundDeposit(w.decisionDeps, { restaurantId: RESTAURANT, bookingId: s.booking.id, actorUserId: STAFF, reason: 'staff' })
    const first = [...w.gateway.refunds.keys()][0]
    await w.deliver(w.gateway.settleRefund(first, false))
    expect(w.ledger.deposits.get(s.deposit.id)?.status).toBe('refund_failed')

    w.gateway.refundOutcome = 'pending'
    expect((await retryDepositRefund(w.decisionDeps, { restaurantId: RESTAURANT, bookingId: s.booking.id, actorUserId: STAFF })).ok).toBe(true)
    expect(w.ledger.deposits.get(s.deposit.id)).toMatchObject({ status: 'refund_pending', refundAttempts: 2 })
    const second = [...w.gateway.refunds.keys()][1]
    expect(second).not.toBe(first)
    // A late "failed" for attempt 1 changes nothing now; attempt 2 settles.
    expect((await w.deliver(w.gateway.settleRefund(first, false))).body).toEqual({ received: true, outcomes: ['duplicate'] })
    await w.deliver(w.gateway.settleRefund(second, true))
    expect(w.ledger.deposits.get(s.deposit.id)?.status).toBe('refunded')
  })
  it('a refund call that errors marks refund_failed; the provider later confirming the payment fully refunded ends refunded', async () => {
    const w = paymentWorld()
    const s = await paidAndCancelled(w)
    w.gateway.failNext('refund', 'unavailable')
    expect(await refundDeposit(w.decisionDeps, { restaurantId: RESTAURANT, bookingId: s.booking.id, actorUserId: STAFF, reason: 'staff' })).toMatchObject({
      ok: true, deposit: { status: 'refund_failed' },
    })
    // Review finding 2: a refund id we never recorded settles nothing (refund-redrive.test.ts); the
    // payment-level "fully refunded" event carries no refund id and is the provider's word on money.
    const confirm = w.gateway.signedEvent({
      id: 'evt_refund_late', type: 'refund.settled', livemode: false, account: s.deposit.providerAccountId,
      payment: w.ledger.deposits.get(s.deposit.id)!.providerPaymentRef!, refund: null, ok: true,
    })
    await w.deliver(confirm)
    expect(w.ledger.deposits.get(s.deposit.id)?.status).toBe('refunded')
  })
})

describe('R57: lapse and payment race', () => {
  it('paid event after lapse -> booking lapsed, refund issued once', async () => {
    const w = paymentWorld()
    const s = await started(w)
    w.gateway.completeSession(s.deposit.providerSessionId!)
    w.advance(31 * 60_000)
    await expireDeposits(w.expireDeps)
    const delivery = w.gateway.completeSession(s.deposit.providerSessionId!)
    await w.deliver(delivery)
    await w.deliver(w.gateway.completeSession(s.deposit.providerSessionId!)) // a second delivery, new event id
    expect(w.ledger.booking(s.booking.id)?.status).toBe('lapsed')
    expect(w.gateway.calls.refund).toBe(1)
  })
  it('lapse after paid -> no change', async () => {
    const w = paymentWorld()
    const s = await started(w)
    await w.deliver(w.gateway.completeSession(s.deposit.providerSessionId!))
    w.advance(31 * 60_000)
    expect((await expireDeposits(w.expireDeps)).depositsLapsed).toBe(0)
    expect(w.ledger.booking(s.booking.id)?.status).toBe('pending')
  })
  it('expire call failing / "already complete" -> no lapse error', async () => {
    const w = paymentWorld()
    const a = await started(w)
    const b = await started(w, { phone: '+85291110000', partySize: 1 })
    w.gateway.completeSession(a.deposit.providerSessionId!)
    w.advance(31 * 60_000)
    w.gateway.failNext('expireHostedPayment')
    const out = await expireDeposits(w.expireDeps)
    expect(out.depositsLapsed).toBe(2)
    expect(w.ledger.booking(a.booking.id)?.status).toBe('lapsed')
    expect(w.ledger.booking(b.booking.id)?.status).toBe('lapsed')
  })
  it('a provider "session expired" event lapses the hold only once its time is up', async () => {
    const w = paymentWorld()
    const s = await started(w)
    expect((await w.deliver(w.gateway.expireSession(s.deposit.providerSessionId!))).body).toEqual({ received: true, outcomes: ['ignored'] })
    expect(w.ledger.booking(s.booking.id)?.status).toBe('awaiting_deposit')
    w.advance(31 * 60_000)
    const other = w.gateway.signedEvent({ id: 'evt_exp_2', type: 'session.expired', livemode: false, account: s.deposit.providerAccountId, session: s.deposit.providerSessionId! })
    expect((await w.deliver(other)).body).toEqual({ received: true, outcomes: ['lapsed'] })
  })
})

describe('R58: every refund / keep finds rows by a tenant-scoped query', () => {
  it("staff of restaurant B refunding A's booking id -> not_found (404) with no provider call", async () => {
    const w = paymentWorld()
    const s = await paidAndCancelled(w)
    const input = { restaurantId: OTHER_RESTAURANT, bookingId: s.booking.id, actorUserId: STAFF }
    expect(await refundDeposit(w.decisionDeps, { ...input, reason: 'staff' })).toEqual({ ok: false, reason: 'not_found' })
    expect(await keepDeposit(w.decisionDeps, input)).toEqual({ ok: false, reason: 'not_found' })
    expect(await retryDepositRefund(w.decisionDeps, input)).toEqual({ ok: false, reason: 'not_found' })
    expect(w.gateway.calls.refund).toBe(0)
    expect(w.ledger.deposits.get(s.deposit.id)?.status).toBe('paid')
  })
  it('a paid deposit on a booking still going ahead cannot be refunded or kept', async () => {
    const w = paymentWorld()
    const s = await started(w)
    await w.deliver(w.gateway.completeSession(s.deposit.providerSessionId!))
    expect((await keepDeposit(w.decisionDeps, { restaurantId: RESTAURANT, bookingId: s.booking.id, actorUserId: STAFF })).ok).toBe(false)
    expect((await refundDeposit(w.decisionDeps, { restaurantId: RESTAURANT, bookingId: s.booking.id, actorUserId: STAFF, reason: 'staff' })).ok).toBe(false)
  })
})

describe('R60: each transition writes exactly one event with the right actor', () => {
  it('created/session -> system, paid -> provider, refund requested -> the staff user, settled -> provider; lapse -> cron', async () => {
    const w = paymentWorld()
    const s = await paidAndCancelled(w)
    await refundDeposit(w.decisionDeps, { restaurantId: RESTAURANT, bookingId: s.booking.id, actorUserId: STAFF, reason: 'staff' })
    expect(w.ledger.eventsOf(s.deposit.id)).toEqual([
      'created:system', 'session_created:system', 'paid:provider', 'refund_requested:user', 'refund_succeeded:provider',
    ])
    expect(w.ledger.events.find((e) => e.depositId === s.deposit.id && e.type === 'refund_requested')?.userId).toBe(STAFF)

    const lapsed = await started(w, { phone: '+85291110000', partySize: 1 })
    w.advance(31 * 60_000)
    await expireDeposits(w.expireDeps)
    expect(w.ledger.eventsOf(lapsed.deposit.id)).toEqual(['created:system', 'session_created:system', 'lapsed:cron'])
  })
})

describe('R62: /p/<token>', () => {
  it('short / unknown / expired token -> neutral not_found / lapsed (no booking details in the state)', async () => {
    const w = paymentWorld()
    await started(w)
    expect(await resolvePaymentLink(w.linkDeps, { token: 'short', returned: null })).toEqual({ kind: 'not_found' })
    expect(await resolvePaymentLink(w.linkDeps, { token: 'B'.repeat(43), returned: null })).toEqual({ kind: 'not_found' })
    w.advance(30 * 60_000)
    expect(await resolvePaymentLink(w.linkDeps, { token: w.tokens[0], returned: null })).toEqual({ kind: 'lapsed' })
  })
  it('stored URL on another host (or not https) -> no redirect', async () => {
    const w = paymentWorld()
    const s = await started(w)
    const row = w.ledger.deposits.get(s.deposit.id)!
    for (const url of ['https://evil.example/s/1', `http://${TEST_PAY_HOST}/s/1`, `https://user@${TEST_PAY_HOST}/s/1`]) {
      row.sessionUrl = url
      expect(await resolvePaymentLink(w.linkDeps, { token: w.tokens[0], returned: null })).toEqual({ kind: 'unavailable' })
    }
  })
  it('the token row holds only the hash; the link and return URLs are built from the app URL server side', async () => {
    const w = paymentWorld()
    const s = await started(w)
    const token = w.tokens[0]
    const row = w.ledger.deposits.get(s.deposit.id)!
    expect(row.linkTokenHash).toBe(hashPaymentLinkToken(token))
    expect(JSON.stringify(row)).not.toContain(token)
    expect(s.paymentUrl).toBe(`https://app.example.test/p/${token}`)
    const session = w.gateway.sessions.get(s.deposit.providerSessionId!)!
    expect(session.successUrl).toBe(`https://app.example.test/p/${token}?return=success`)
    expect(session.cancelUrl).toBe(`https://app.example.test/p/${token}?return=cancel`)
    expect(await resolvePaymentLink(w.linkDeps, { token, returned: 'success' })).toEqual({ kind: 'processing' })
    expect(await resolvePaymentLink(w.linkDeps, { token, returned: 'cancel' })).toEqual({ kind: 'unfinished', holdExpiresAt: s.expiresAt })
  })
})

describe('R61: what the provider gets', () => {
  it('metadata is exactly {deposit_id, booking_id}; the line item names no diner', async () => {
    const w = paymentWorld()
    const s = await started(w)
    const session = w.gateway.sessions.get(s.deposit.providerSessionId!)!
    expect(session.metadata).toEqual({ deposit_id: s.deposit.id, booking_id: s.booking.id })
    expect(session.description).toBe('Deposit · Café A · 2026-12-24 19:00 · 4 guests')
    expect(session.description).not.toContain('Chan')
    expect(session.description).not.toContain('+852')
  })
})

describe('R64: diners and agents get fixed codes only', () => {
  it('provider throws with an account id in its message -> the result carries neither; the server log has it', async () => {
    const w = paymentWorld()
    const original = w.gateway.createHostedPayment.bind(w.gateway)
    w.gateway.createHostedPayment = async () => {
      throw new PaymentGatewayError('rejected', 'No such account: acct_1SECRETxyz; request req_9')
    }
    const r = await w.book()
    expect(r).toEqual({ kind: 'payment_unavailable' })
    expect(JSON.stringify(r)).not.toContain('acct_1SECRETxyz')
    expect(JSON.stringify(w.lines)).toContain('acct_1SECRETxyz')
    w.gateway.createHostedPayment = original
  })
  it('webhook answers carry fixed codes, never provider text', async () => {
    const w = paymentWorld()
    const out = await processPaymentWebhook(w.webhookDeps, { rawBody: '{"id":"x"}', headers: new Headers({ 'x-test-signature': 't=1,v1=00' }) })
    expect(out).toEqual({ status: 400, body: { error: 'invalid_signature' } })
  })
})

// BOOK-014 W1-fix (PR #237 review findings 1 and 2; threat R56, R57): money
// owed is always returned, and refund status follows the provider.
// Finding 1: a refund_pending deposit with no refund id is re-driven (a
// redelivered late payment, the cron sweep) with the SAME attempt, so the
// same idempotency key; a provider "already fully refunded" answer is refunded.
// Finding 2: a refund webhook settles only through the attempt that created
// its refund id.
import { describe, it, expect } from 'vitest'
import { expireDeposits } from '../expire-deposits'
import { issueRefund } from '../issue-refund'
import { redriveStalledRefunds, STALLED_REFUND_AFTER_MS } from '../redrive-stalled-refunds'
import { refundDeposit, retryDepositRefund } from '../deposit-decisions'
import { RESTAURANT, paymentWorld } from '@/test-utils/payment-world'
import type { RefundRequest } from '@/domain/ports/payment-gateway'

const STAFF = 'staff-user-1'
type World = ReturnType<typeof paymentWorld>

async function started(w: World, phone = '+85291234567') {
  const r = await w.book({ phone })
  if (r.kind !== 'started') throw new Error(`expected started, got ${r.kind}`)
  return r
}

async function paidAndCancelled(w: World, phone?: string) {
  const s = await started(w, phone)
  await w.deliver(w.gateway.completeSession(s.deposit.providerSessionId!))
  w.ledger.setBookingStatus(s.booking.id, 'cancelled')
  return s
}

/** Records the idempotency key of every refund call that reaches the provider adapter. */
function refundKeys(w: World): string[] {
  const keys: string[] = []
  const original = w.gateway.refund.bind(w.gateway)
  w.gateway.refund = (request: RefundRequest) => {
    keys.push(request.idempotencyKey)
    return original(request)
  }
  return keys
}

/** Staff pressed Refund and the process died before the provider call (refund_pending, no refund id). */
async function stalledAt(w: World, phone: string) {
  const s = await paidAndCancelled(w, phone)
  const begun = await w.ledger.beginRefund({
    depositId: s.deposit.id, restaurantId: RESTAURANT, from: 'paid', reason: 'staff', bookingStatuses: ['cancelled'],
    actor: { kind: 'user', userId: STAFF }, at: w.now(),
  })
  if (!begun) throw new Error('beginRefund lost')
  return s
}

const row = (w: World, id: string) => w.ledger.deposits.get(id)!

describe('finding 1a: a redelivered late payment re-drives a refund that was never issued', () => {
  it('refund call throws AND finishRefund throws -> 500; the redelivery is a duplicate payment yet the refund runs once more with the same key', async () => {
    const w = paymentWorld()
    const s = await started(w)
    w.gateway.completeSession(s.deposit.providerSessionId!)
    w.advance(31 * 60_000)
    await expireDeposits(w.expireDeps)
    const delivery = w.gateway.completeSession(s.deposit.providerSessionId!)
    const keys = refundKeys(w)

    w.gateway.failNext('refund', 'unavailable')
    w.ledger.failNext = 'finishRefund'
    expect(await w.deliver(delivery)).toEqual({ status: 500, body: { error: 'processing_failed' } })
    expect(row(w, s.deposit.id)).toMatchObject({ status: 'refund_pending', refundReason: 'late_payment', refundRef: null, refundAttempts: 1 })

    expect((await w.deliver(delivery)).body).toEqual({ received: true, outcomes: ['late_refunded'] })
    expect(keys).toEqual([`refund:${s.deposit.id}:1`, `refund:${s.deposit.id}:1`])
    expect(row(w, s.deposit.id)).toMatchObject({ status: 'refunded', refundAttempts: 1 })
    expect(w.ledger.booking(s.booking.id)?.status).toBe('lapsed')
  })

  it('a redelivery after the refund was issued (refund id stored) does not call the provider again', async () => {
    const w = paymentWorld()
    const s = await started(w)
    w.gateway.completeSession(s.deposit.providerSessionId!)
    w.advance(31 * 60_000)
    await expireDeposits(w.expireDeps)
    const delivery = w.gateway.completeSession(s.deposit.providerSessionId!)
    w.gateway.refundOutcome = 'pending'
    expect((await w.deliver(delivery)).body).toEqual({ received: true, outcomes: ['late_refunded'] })
    w.claims.keys.clear()
    expect((await w.deliver(delivery)).body).toEqual({ received: true, outcomes: ['duplicate'] })
    expect(w.gateway.calls.refund).toBe(1)
  })
})

describe('finding 1b: the cron sweep re-drives stalled refunds', () => {
  it('re-drives a refund_pending row with no refund id older than 10 minutes (same key); skips a fresh one and one with a refund id', async () => {
    const w = paymentWorld()
    const stale = await stalledAt(w, '+85291000001')
    const withRef = await paidAndCancelled(w, '+85291000002')
    w.gateway.refundOutcome = 'pending'
    await refundDeposit(w.decisionDeps, { restaurantId: RESTAURANT, bookingId: withRef.booking.id, actorUserId: STAFF, reason: 'staff' })
    w.gateway.refundOutcome = 'succeeded'
    w.advance(STALLED_REFUND_AFTER_MS - 60_000)
    const fresh = await stalledAt(w, '+85291000003')
    w.advance(2 * 60_000)
    const keys = refundKeys(w)

    expect(await redriveStalledRefunds(w.redriveDeps)).toEqual({ refundsRedriven: 1 })
    expect(keys).toEqual([`refund:${stale.deposit.id}:1`])
    expect(row(w, stale.deposit.id)).toMatchObject({ status: 'refunded', refundAttempts: 1 })
    expect(row(w, fresh.deposit.id)).toMatchObject({ status: 'refund_pending', refundRef: null })
    expect(row(w, withRef.deposit.id).status).toBe('refund_pending')
    expect(row(w, withRef.deposit.id).refundRef).not.toBeNull()
  })

  it('a re-drive whose provider call fails ends refund_failed (staff see Retry) and is not swept again', async () => {
    const w = paymentWorld()
    const stale = await stalledAt(w, '+85291000001')
    w.advance(STALLED_REFUND_AFTER_MS + 60_000)
    w.gateway.failNext('refund', 'unavailable')
    expect(await redriveStalledRefunds(w.redriveDeps)).toEqual({ refundsRedriven: 1 })
    expect(row(w, stale.deposit.id).status).toBe('refund_failed')
    expect(await redriveStalledRefunds(w.redriveDeps)).toEqual({ refundsRedriven: 0 })
  })
})

describe('finding 1c: the provider says the payment is already fully refunded', () => {
  it('-> refunded, not refund_failed (the original idempotency key has expired)', async () => {
    const w = paymentWorld()
    const s = await paidAndCancelled(w)
    const paymentRef = row(w, s.deposit.id).providerPaymentRef!
    await w.gateway.refund({ accountRef: s.deposit.providerAccountId, paymentRef, amount: s.deposit.amount, idempotencyKey: 'an-older-key' })
    expect(await refundDeposit(w.decisionDeps, { restaurantId: RESTAURANT, bookingId: s.booking.id, actorUserId: STAFF, reason: 'staff' })).toMatchObject({
      ok: true, deposit: { status: 'refunded' },
    })
    expect(w.ledger.eventsOf(s.deposit.id).at(-1)).toBe('refund_succeeded:provider')
  })
})

describe('finding 2: refund webhooks settle through the attempt that created the refund id', () => {
  async function failedThenRetrying(w: World) {
    const s = await paidAndCancelled(w)
    w.gateway.refundOutcome = 'failed'
    await refundDeposit(w.decisionDeps, { restaurantId: RESTAURANT, bookingId: s.booking.id, actorUserId: STAFF, reason: 'staff' })
    const re1 = [...w.gateway.refunds.keys()][0]
    expect(row(w, s.deposit.id)).toMatchObject({ status: 'refund_failed', refundRef: re1 })
    return { s, re1 }
  }

  it('attempt 1 re_1 failed, Retry -> attempt 2 in flight; a delayed failed/canceled webhook for re_1 changes nothing; attempt 2 succeeding -> refunded', async () => {
    const w = paymentWorld()
    const { s, re1 } = await failedThenRetrying(w)
    const begun = await w.ledger.beginRefund({
      depositId: s.deposit.id, restaurantId: RESTAURANT, from: 'refund_failed', reason: 'staff', bookingStatuses: [],
      actor: { kind: 'user', userId: STAFF }, at: w.now(),
    })
    expect(begun).toMatchObject({ status: 'refund_pending', refundAttempts: 2, refundRef: null })

    expect((await w.deliver(w.gateway.settleRefund(re1, false))).body).toEqual({ received: true, outcomes: ['duplicate'] })
    expect(row(w, s.deposit.id)).toMatchObject({ status: 'refund_pending', refundAttempts: 2, refundRef: null })

    w.gateway.refundOutcome = 'succeeded'
    expect(await issueRefund(w.decisionDeps, begun!)).toMatchObject({ status: 'refunded' })
    expect(row(w, s.deposit.id).refundRef).not.toBe(re1)
  })

  it('an older attempt’s refund id that succeeds -> refunded (provider truth on money), and no further attempt runs', async () => {
    const w = paymentWorld()
    const { s, re1 } = await failedThenRetrying(w)
    w.gateway.refundOutcome = 'pending'
    expect((await retryDepositRefund(w.decisionDeps, { restaurantId: RESTAURANT, bookingId: s.booking.id, actorUserId: STAFF })).ok).toBe(true)
    expect(row(w, s.deposit.id)).toMatchObject({ status: 'refund_pending', refundAttempts: 2 })
    expect(row(w, s.deposit.id).refundRef).not.toBe(re1)

    expect((await w.deliver(w.gateway.settleRefund(re1, true))).body).toEqual({ received: true, outcomes: ['refund_settled'] })
    expect(row(w, s.deposit.id).status).toBe('refunded')
    const calls = w.gateway.calls.refund
    expect(await retryDepositRefund(w.decisionDeps, { restaurantId: RESTAURANT, bookingId: s.booking.id, actorUserId: STAFF })).toEqual({
      ok: false, reason: 'conflict', status: 'refunded',
    })
    expect(w.gateway.calls.refund).toBe(calls)
  })

  it('a refund id we never recorded settles nothing; "the payment is fully refunded" (no refund id) is provider truth', async () => {
    const w = paymentWorld()
    const s = await paidAndCancelled(w)
    w.gateway.failNext('refund', 'unavailable')
    await refundDeposit(w.decisionDeps, { restaurantId: RESTAURANT, bookingId: s.booking.id, actorUserId: STAFF, reason: 'staff' })
    expect(row(w, s.deposit.id).status).toBe('refund_failed')
    const event = (id: string, refund: string | null) =>
      w.gateway.signedEvent({
        id, type: 'refund.settled', livemode: false, account: s.deposit.providerAccountId,
        payment: row(w, s.deposit.id).providerPaymentRef!, refund, ok: true,
      })
    expect((await w.deliver(event('evt_unknown_ref', 'rf_unknown'))).body).toEqual({ received: true, outcomes: ['duplicate'] })
    expect(row(w, s.deposit.id).status).toBe('refund_failed')
    expect((await w.deliver(event('evt_charge_refunded', null))).body).toEqual({ received: true, outcomes: ['refund_settled'] })
    expect(row(w, s.deposit.id).status).toBe('refunded')
  })
})

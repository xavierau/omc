// BOOK-014 W6-fix (PR #237 /code-review F1, F2, F4, F6, F7; threat R56, R57):
// refund state follows the refund we recorded, never a payment-level event.
// F1: Stripe's charge.refunded (payment_refunded here) fires while a refund is
//     still pending and names no refund: it settles nothing of ours.
// F2: a late-payment refund that ends refund_failed (the booking lapsed, staff
//     never see it) is retried by the sweep as a new attempt, with backoff, up
//     to a cap; then it is logged at error level and left refund_failed.
// F4: a refund event that lands before its refund id is recorded is answered
//     retryable (503, claim released), so the redelivery settles it.
// F6: an account event older than the last one applied is skipped.
// F7: a deposit refunded in the provider's dashboard moves paid -> refunded
//     (provider_dashboard, actor provider), and Keep is then a conflict (409).
import { describe, it, expect } from 'vitest'
import { expireDeposits } from '../expire-deposits'
import { keepDeposit, refundDeposit, retryDepositRefund } from '../deposit-decisions'
import { LATE_REFUND_BACKOFF_BASE_MS, LATE_REFUND_BACKOFF_FACTOR, LATE_REFUND_MAX_ATTEMPTS, redriveStalledRefunds } from '../redrive-stalled-refunds'
import { ACCOUNT_REF, RESTAURANT, paymentWorld } from '@/test-utils/payment-world'
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

const row = (w: World, id: string) => w.ledger.deposits.get(id)!
const paymentOf = (w: World, id: string) => row(w, id).providerPaymentRef!

function refundKeys(w: World): string[] {
  const keys: string[] = []
  const original = w.gateway.refund.bind(w.gateway)
  w.gateway.refund = (request: RefundRequest) => {
    keys.push(request.idempotencyKey)
    return original(request)
  }
  return keys
}

/** The diner pays after the hold lapsed; the automatic refund is refused by the provider -> refund_failed (late_payment). */
async function lateRefundFailed(w: World) {
  const s = await started(w)
  w.gateway.completeSession(s.deposit.providerSessionId!)
  w.advance(31 * 60_000)
  await expireDeposits(w.expireDeps)
  w.gateway.failNext('refund', 'rejected')
  expect((await w.deliver(w.gateway.completeSession(s.deposit.providerSessionId!))).body).toEqual({ received: true, outcomes: ['late_refund_failed'] })
  expect(row(w, s.deposit.id)).toMatchObject({ status: 'refund_failed', refundReason: 'late_payment', refundAttempts: 1 })
  return s
}

describe('F1: a payment-level "refunded" event settles none of our refunds', () => {
  it('F1 pending refund + charge.refunded -> still refund_pending, then refund.updated failed -> refund_failed', async () => {
    const w = paymentWorld()
    const s = await paidAndCancelled(w)
    w.gateway.refundOutcome = 'pending'
    await refundDeposit(w.decisionDeps, { restaurantId: RESTAURANT, bookingId: s.booking.id, actorUserId: STAFF, reason: 'staff' })
    const pendingRef = row(w, s.deposit.id).refundRef!
    expect(row(w, s.deposit.id)).toMatchObject({ status: 'refund_pending', refundAttempts: 1 })

    // Stripe sends charge.refunded when the refund is created (pending counts toward amount_refunded).
    const charge = await w.deliver(w.gateway.paymentRefunded(paymentOf(w, s.deposit.id)))
    expect(charge.body).toEqual({ received: true, outcomes: ['ignored'] })
    expect(row(w, s.deposit.id).status).toBe('refund_pending')
    expect(w.lines.some((l) => l.event === 'payment.refund_event_not_ours' && l.data.depositId === s.deposit.id)).toBe(true)

    // The pending refund then fails: that later event is NOT dropped.
    expect((await w.deliver(w.gateway.settleRefund(pendingRef, false))).body).toEqual({ received: true, outcomes: ['refund_settled'] })
    expect(row(w, s.deposit.id).status).toBe('refund_failed')
    expect(w.ledger.eventsOf(s.deposit.id)).not.toContain('refund_succeeded:provider')
  })

  it('F1 a refund_failed deposit (an attempt of ours) is not marked refunded by charge.refunded; Retry finds it already refunded', async () => {
    const w = paymentWorld()
    const s = await paidAndCancelled(w)
    w.gateway.failNext('refund', 'unavailable')
    await refundDeposit(w.decisionDeps, { restaurantId: RESTAURANT, bookingId: s.booking.id, actorUserId: STAFF, reason: 'staff' })
    expect(row(w, s.deposit.id).status).toBe('refund_failed')
    // Someone refunds it in the dashboard meanwhile.
    expect((await w.deliver(w.gateway.refundExternally(paymentOf(w, s.deposit.id)))).body).toEqual({ received: true, outcomes: ['ignored'] })
    expect(row(w, s.deposit.id).status).toBe('refund_failed')
    // Staff Retry (a new attempt) gets the provider's "already refunded": refunded, no second refund.
    const before = w.gateway.refunds.size
    expect(await retryDepositRefund(w.decisionDeps, { restaurantId: RESTAURANT, bookingId: s.booking.id, actorUserId: STAFF })).toMatchObject({
      ok: true, deposit: { status: 'refunded', refundAttempts: 2 },
    })
    expect(w.gateway.refunds.size).toBe(before)
  })
})

describe('F2: a late-payment refund that failed is retried by the sweep, capped', () => {
  it(`F2 late refund_failed re-driven with a new attempt and key, backoff ${LATE_REFUND_BACKOFF_BASE_MS / 60_000} min x${LATE_REFUND_BACKOFF_FACTOR}, stops at the cap (${LATE_REFUND_MAX_ATTEMPTS})`, async () => {
    const w = paymentWorld()
    const s = await lateRefundFailed(w)
    const keys = refundKeys(w)

    // Not due yet: nothing is retried right after the failure.
    expect(await redriveStalledRefunds(w.redriveDeps)).toEqual({ refundsRedriven: 0, lateRefundsRetried: 0 })
    expect(keys).toEqual([])

    for (let attempt = 2; attempt <= LATE_REFUND_MAX_ATTEMPTS; attempt++) {
      const wait = LATE_REFUND_BACKOFF_BASE_MS * LATE_REFUND_BACKOFF_FACTOR ** (attempt - 2)
      w.advance(wait - 60_000)
      expect((await redriveStalledRefunds(w.redriveDeps)).lateRefundsRetried).toBe(0)
      w.advance(60_000)
      w.gateway.failNext('refund', 'rejected')
      expect((await redriveStalledRefunds(w.redriveDeps)).lateRefundsRetried).toBe(1)
      expect(keys[keys.length - 1]).toBe(`refund:${s.deposit.id}:${attempt}`)
      expect(row(w, s.deposit.id)).toMatchObject({ status: 'refund_failed', refundReason: 'late_payment', refundAttempts: attempt })
    }
    expect(keys).toHaveLength(LATE_REFUND_MAX_ATTEMPTS - 1)
    const gaveUp = w.lines.filter((l) => l.event === 'deposit.late_refund_gave_up')
    expect(gaveUp).toHaveLength(1)
    expect(gaveUp[0]).toMatchObject({ level: 'error', data: { depositId: s.deposit.id, attempts: LATE_REFUND_MAX_ATTEMPTS } })

    // At the cap: never retried again, stays refund_failed.
    w.advance(7 * 24 * 60 * 60_000)
    expect((await redriveStalledRefunds(w.redriveDeps)).lateRefundsRetried).toBe(0)
    expect(keys).toHaveLength(LATE_REFUND_MAX_ATTEMPTS - 1)
    expect(row(w, s.deposit.id).status).toBe('refund_failed')
    expect(w.ledger.eventsOf(s.deposit.id).filter((e) => e === 'refund_requested:cron')).toHaveLength(LATE_REFUND_MAX_ATTEMPTS - 1)
  })

  it('F2 a retry that succeeds ends refunded with that attempt', async () => {
    const w = paymentWorld()
    const s = await lateRefundFailed(w)
    w.advance(LATE_REFUND_BACKOFF_BASE_MS)
    expect((await redriveStalledRefunds(w.redriveDeps)).lateRefundsRetried).toBe(1)
    expect(row(w, s.deposit.id)).toMatchObject({ status: 'refunded', refundAttempts: 2 })
  })

  it('F2 a retry whose refund is pending stays refund_pending with its id; the refund event settles it', async () => {
    const w = paymentWorld()
    const s = await lateRefundFailed(w)
    w.advance(LATE_REFUND_BACKOFF_BASE_MS)
    w.gateway.refundOutcome = 'pending'
    await redriveStalledRefunds(w.redriveDeps)
    const ref = row(w, s.deposit.id).refundRef!
    expect(row(w, s.deposit.id)).toMatchObject({ status: 'refund_pending', refundAttempts: 2 })
    expect((await w.deliver(w.gateway.settleRefund(ref, true))).body).toEqual({ received: true, outcomes: ['refund_settled'] })
    expect(row(w, s.deposit.id).status).toBe('refunded')
  })

  it('F2 the last attempt failing by webhook is logged at the cap too', async () => {
    const w = paymentWorld()
    const s = await lateRefundFailed(w)
    for (let attempt = 2; attempt < LATE_REFUND_MAX_ATTEMPTS; attempt++) {
      w.advance(LATE_REFUND_BACKOFF_BASE_MS * LATE_REFUND_BACKOFF_FACTOR ** (attempt - 2))
      w.gateway.failNext('refund', 'rejected')
      await redriveStalledRefunds(w.redriveDeps)
    }
    w.advance(LATE_REFUND_BACKOFF_BASE_MS * LATE_REFUND_BACKOFF_FACTOR ** (LATE_REFUND_MAX_ATTEMPTS - 2))
    w.gateway.refundOutcome = 'pending'
    await redriveStalledRefunds(w.redriveDeps)
    expect(row(w, s.deposit.id)).toMatchObject({ status: 'refund_pending', refundAttempts: LATE_REFUND_MAX_ATTEMPTS })
    await w.deliver(w.gateway.settleRefund(row(w, s.deposit.id).refundRef!, false))
    expect(row(w, s.deposit.id).status).toBe('refund_failed')
    expect(w.lines.filter((l) => l.event === 'deposit.late_refund_gave_up' && l.level === 'error')).toHaveLength(1)
  })

  it('F2 a staff-path refund_failed is NOT retried by the sweep (staff press Retry)', async () => {
    const w = paymentWorld()
    const s = await paidAndCancelled(w)
    w.gateway.failNext('refund', 'rejected')
    await refundDeposit(w.decisionDeps, { restaurantId: RESTAURANT, bookingId: s.booking.id, actorUserId: STAFF, reason: 'staff' })
    expect(row(w, s.deposit.id)).toMatchObject({ status: 'refund_failed', refundReason: 'staff' })
    const keys = refundKeys(w)
    w.advance(48 * 60 * 60_000)
    expect((await redriveStalledRefunds(w.redriveDeps)).lateRefundsRetried).toBe(0)
    expect(keys).toEqual([])
    expect(row(w, s.deposit.id).status).toBe('refund_failed')
  })
})

describe('F4: a refund event before its refund id is recorded is retryable', () => {
  it('F4 refund.updated before recordRefundRef -> 503 + claim released, then the redelivery settles it', async () => {
    const w = paymentWorld()
    const s = await paidAndCancelled(w)
    w.gateway.refundOutcome = 'pending'
    const original = w.gateway.refund.bind(w.gateway)
    let early: { delivery: ReturnType<typeof w.gateway.settleRefund>; response: Awaited<ReturnType<typeof w.deliver>> } | null = null
    w.gateway.refund = async (request: RefundRequest) => {
      const result = await original(request)
      // The provider's webhook wins the race against recordRefundRef.
      const delivery = w.gateway.settleRefund(result.refundRef!, true)
      early = { delivery, response: await w.deliver(delivery) }
      return result
    }
    await refundDeposit(w.decisionDeps, { restaurantId: RESTAURANT, bookingId: s.booking.id, actorUserId: STAFF, reason: 'staff' })
    expect(early).not.toBeNull()
    const first = early!
    expect(first.response.status).toBe(503)
    expect(first.response.body).toEqual({ error: 'retry_later' })
    expect(w.claims.releases).toHaveLength(1)
    expect(w.claims.keys.has(w.claims.releases[0])).toBe(false)
    expect(row(w, s.deposit.id)).toMatchObject({ status: 'refund_pending' })
    expect(w.lines.some((l) => l.event === 'payment.refund_ref_not_recorded_yet')).toBe(true)

    // Stripe redelivers the same event: the id is recorded now, so it settles.
    const again = await w.deliver(first.delivery)
    expect(again).toEqual({ status: 200, body: { received: true, outcomes: ['refund_settled'] } })
    expect(row(w, s.deposit.id).status).toBe('refunded')
  })

  it('F4 a refund id of an earlier attempt still changes nothing (200 duplicate), and an unknown id on a settled deposit is not retried', async () => {
    const w = paymentWorld()
    const s = await paidAndCancelled(w)
    w.gateway.refundOutcome = 'failed'
    await refundDeposit(w.decisionDeps, { restaurantId: RESTAURANT, bookingId: s.booking.id, actorUserId: STAFF, reason: 'staff' })
    const re1 = row(w, s.deposit.id).refundRef!
    w.gateway.refundOutcome = 'pending'
    await retryDepositRefund(w.decisionDeps, { restaurantId: RESTAURANT, bookingId: s.booking.id, actorUserId: STAFF })
    expect(row(w, s.deposit.id)).toMatchObject({ status: 'refund_pending', refundAttempts: 2 })
    expect((await w.deliver(w.gateway.settleRefund(re1, false))).body).toEqual({ received: true, outcomes: ['duplicate'] })
    expect(row(w, s.deposit.id).status).toBe('refund_pending')

    await w.deliver(w.gateway.settleRefund(row(w, s.deposit.id).refundRef!, true))
    expect(row(w, s.deposit.id).status).toBe('refunded')
    const stray = w.gateway.signedEvent({
      id: 'evt_stray', type: 'refund.settled', livemode: false, account: ACCOUNT_REF, payment: paymentOf(w, s.deposit.id), refund: 'rf_never', ok: true,
    })
    expect(await w.deliver(stray)).toEqual({ status: 200, body: { received: true, outcomes: ['duplicate'] } })
  })
})

describe('F7: a refund made in the provider dashboard', () => {
  it('F7 dashboard refund of a paid deposit -> refunded/provider (provider_dashboard), and Keep -> conflict (409)', async () => {
    const w = paymentWorld()
    const s = await paidAndCancelled(w)
    const delivery = w.gateway.refundExternally(paymentOf(w, s.deposit.id))
    expect((await w.deliver(delivery)).body).toEqual({ received: true, outcomes: ['refund_settled'] })
    expect(row(w, s.deposit.id)).toMatchObject({ status: 'refunded', refundReason: 'provider_dashboard', refundAttempts: 0 })
    expect(w.ledger.eventsOf(s.deposit.id)).toContain('refund_succeeded:provider')
    expect(w.gateway.calls.confirmFullyRefunded).toBe(1)
    expect(await keepDeposit(w.decisionDeps, { restaurantId: RESTAURANT, bookingId: s.booking.id, actorUserId: STAFF })).toEqual({
      ok: false, reason: 'conflict', status: 'refunded',
    })
    // A replay changes nothing more.
    expect((await w.deliver(delivery)).body).toEqual({ received: true, outcomes: ['duplicate'] })
  })

  it('F7 a paid deposit on a booking still going ahead also moves (the money is back)', async () => {
    const w = paymentWorld()
    const s = await started(w)
    await w.deliver(w.gateway.completeSession(s.deposit.providerSessionId!))
    await w.deliver(w.gateway.refundExternally(paymentOf(w, s.deposit.id)))
    expect(row(w, s.deposit.id)).toMatchObject({ status: 'refunded', refundReason: 'provider_dashboard' })
  })

  it('F7 a dashboard refund still pending, or only partial, is logged and changes nothing', async () => {
    const w = paymentWorld()
    const s = await paidAndCancelled(w)
    const pending = await w.deliver(w.gateway.refundExternally(paymentOf(w, s.deposit.id), { status: 'pending' }))
    expect(pending.body).toEqual({ received: true, outcomes: ['ignored'] })
    expect(row(w, s.deposit.id).status).toBe('paid')

    const w2 = paymentWorld()
    const s2 = await paidAndCancelled(w2)
    const partial = await w2.deliver(w2.gateway.refundExternally(paymentOf(w2, s2.deposit.id), { amountMinor: 100 }))
    expect(partial.body).toEqual({ received: true, outcomes: ['ignored'] })
    expect(row(w2, s2.deposit.id).status).toBe('paid')
    expect(w2.gateway.calls.confirmFullyRefunded).toBe(0)
    for (const lines of [w.lines, w2.lines]) expect(lines.some((l) => l.event === 'payment.provider_refund_not_settled')).toBe(true)
  })

  it('F7 the provider cannot confirm the refunds -> 500, claim released (the provider retries)', async () => {
    const w = paymentWorld()
    const s = await paidAndCancelled(w)
    w.gateway.failNext('confirmFullyRefunded', 'unavailable')
    const res = await w.deliver(w.gateway.refundExternally(paymentOf(w, s.deposit.id)))
    expect(res.status).toBe(500)
    expect(w.claims.releases).toHaveLength(1)
    expect(row(w, s.deposit.id).status).toBe('paid')
  })
})

describe('F6: account events apply in event-time order', () => {
  it('F6 older account event skipped: an account.updated created before the last one applied changes nothing', async () => {
    const w = paymentWorld()
    const account = w.accountStore.seed({ restaurantId: RESTAURANT, providerCode: 'test', providerAccountId: ACCOUNT_REF, status: 'pending' })
    const t = Math.floor(w.now().getTime() / 1000)
    const event = (id: string, created: number, charges: boolean) =>
      w.gateway.signedEvent({ id, type: 'account.updated', livemode: false, account: ACCOUNT_REF, charges, currency: 'HKD', created })

    expect((await w.deliver(event('evt_new', t, true))).body).toEqual({ received: true, outcomes: ['account_updated'] })
    expect(w.accountStore.rows.get(account.id)).toMatchObject({ status: 'active', chargesEnabled: true })
    // An event Stripe created 10 s earlier arrives late: skipped.
    expect((await w.deliver(event('evt_old', t - 10, false))).body).toEqual({ received: true, outcomes: ['ignored'] })
    expect(w.accountStore.rows.get(account.id)).toMatchObject({ status: 'active', chargesEnabled: true })
    expect(w.lines.some((l) => l.event === 'payment_account.event_stale' && l.data.eventId === 'evt_old')).toBe(true)
    // A newer one applies.
    expect((await w.deliver(event('evt_newer', t + 5, false))).body).toEqual({ received: true, outcomes: ['account_updated'] })
    expect(w.accountStore.rows.get(account.id)).toMatchObject({ chargesEnabled: false })
    expect(w.accountStore.lastWebhookAt.get(account.id)).toBe((t + 5) * 1000)
  })
})

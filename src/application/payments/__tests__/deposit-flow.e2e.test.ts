// BOOK-014 W1 (spec AC-16): the whole deposit flow on the in-repo TEST
// provider adapter, through the same port, use cases and webhook processing
// Stripe uses: no Stripe anywhere. Covers spec AC-6 (paid -> pending, once),
// AC-7 (lapse, seats freed, session closed), AC-8 (late payment -> refund,
// booking stays lapsed), AC-12 (decline -> refund), AC-13 (refund / keep).
import { describe, it, expect } from 'vitest'
import { expireDeposits } from '../expire-deposits'
import { keepDeposit, refundDeposit } from '../deposit-decisions'
import { resolvePaymentLink } from '../resolve-payment-link'
import { paymentWorld } from '@/test-utils/payment-world'

const STAFF = 'staff-user-1'

async function started(w: ReturnType<typeof paymentWorld>) {
  const result = await w.book()
  if (result.kind !== 'started') throw new Error(`expected started, got ${result.kind}`)
  return result
}

describe('AC-16: deposit flow on the test adapter', () => {
  it('AC-5/AC-6: startDeposit -> paid (signed webhook) -> booking pending exactly once; replay changes nothing', async () => {
    const w = paymentWorld()
    const s = await started(w)
    expect(s.booking.status).toBe('awaiting_deposit')
    expect(s.amount).toEqual({ amountMinor: 40000, currency: 'HKD' })
    expect(w.ledger.guests('2026-12-24', '19:00')).toBe(4)
    expect(await resolvePaymentLink(w.linkDeps, { token: w.tokens[0], returned: null })).toEqual({ kind: 'redirect', url: s.deposit.sessionUrl })

    const delivery = w.gateway.completeSession(s.deposit.providerSessionId!)
    expect((await w.deliver(delivery)).status).toBe(200)
    expect(w.ledger.booking(s.booking.id)?.status).toBe('pending')
    expect(w.ledger.deposits.get(s.deposit.id)?.status).toBe('paid')
    expect(w.paidHook).toHaveLength(1)

    const replay = await w.deliver(delivery)
    expect(replay).toEqual({ status: 200, body: { received: true, outcomes: ['duplicate'] } })
    expect(w.paidHook).toHaveLength(1)
    expect(w.ledger.eventsOf(s.deposit.id)).toEqual(['created:system', 'session_created:system', 'paid:provider'])
    expect(await resolvePaymentLink(w.linkDeps, { token: w.tokens[0], returned: null })).toEqual({ kind: 'paid' })
  })

  it('AC-7: no payment within 30 minutes -> lapsed, seats released, provider session closed, link says lapsed', async () => {
    const w = paymentWorld()
    const s = await started(w)
    w.advance(29 * 60_000)
    expect((await expireDeposits(w.expireDeps)).depositsLapsed).toBe(0)
    w.advance(2 * 60_000)
    expect(await expireDeposits(w.expireDeps)).toEqual({ depositsLapsed: 1, sessionsClosed: 1 })
    expect(w.ledger.booking(s.booking.id)?.status).toBe('lapsed')
    expect(w.ledger.guests('2026-12-24', '19:00')).toBe(0)
    expect(w.gateway.sessions.get(s.deposit.providerSessionId!)?.status).toBe('expired')
    expect(await resolvePaymentLink(w.linkDeps, { token: w.tokens[0], returned: null })).toEqual({ kind: 'lapsed' })
  })

  it('AC-8: a payment confirmed after the lapse is refunded in full automatically; the booking stays lapsed', async () => {
    const w = paymentWorld()
    const s = await started(w)
    w.gateway.completeSession(s.deposit.providerSessionId!) // paid at the provider just before the lapse
    w.advance(31 * 60_000)
    expect(await expireDeposits(w.expireDeps)).toEqual({ depositsLapsed: 1, sessionsClosed: 0 }) // "already completed": no error
    // The provider's (re)delivery of that completion arrives after the lapse, freshly signed.
    const delivery = w.gateway.completeSession(s.deposit.providerSessionId!)
    expect((await w.deliver(delivery)).body).toEqual({ received: true, outcomes: ['late_refunded'] })
    expect(w.ledger.booking(s.booking.id)?.status).toBe('lapsed')
    expect(w.ledger.deposits.get(s.deposit.id)).toMatchObject({ status: 'refunded', refundReason: 'late_payment', refundAttempts: 1 })
    expect([...w.gateway.refunds.values()]).toEqual([expect.objectContaining({ amount: { amountMinor: 40000, currency: 'HKD' }, status: 'succeeded' })])
    expect(w.gateway.calls.refund).toBe(1)
    expect(w.paidHook).toHaveLength(0)
  })

  it('AC-12: staff decline a paid booking -> full refund; refund webhook replay changes nothing', async () => {
    const w = paymentWorld()
    const s = await started(w)
    await w.deliver(w.gateway.completeSession(s.deposit.providerSessionId!))
    w.ledger.setBookingStatus(s.booking.id, 'declined')
    w.gateway.refundOutcome = 'pending'
    const refunded = await refundDeposit(w.decisionDeps, { restaurantId: s.booking.restaurantId, bookingId: s.booking.id, actorUserId: STAFF, reason: 'declined' })
    expect(refunded).toMatchObject({ ok: true, deposit: { status: 'refund_pending', refundReason: 'declined' } })
    const refundRef = [...w.gateway.refunds.keys()][0]
    const settle = w.gateway.settleRefund(refundRef, true)
    expect((await w.deliver(settle)).body).toEqual({ received: true, outcomes: ['refund_settled'] })
    expect(w.ledger.deposits.get(s.deposit.id)?.status).toBe('refunded')
    expect((await w.deliver(settle)).body).toEqual({ received: true, outcomes: ['duplicate'] })
  })

  it('AC-13: cancelled -> Refund (refunded) or Keep (kept); either ends the choice', async () => {
    const w = paymentWorld()
    const a = await started(w)
    const b = await w.book({ phone: '+85291110000', partySize: 2 })
    if (b.kind !== 'started') throw new Error(b.kind)
    for (const s of [a, b]) {
      await w.deliver(w.gateway.completeSession(s.deposit.providerSessionId!))
      w.ledger.setBookingStatus(s.booking.id, 'cancelled')
    }
    const input = (id: string) => ({ restaurantId: a.booking.restaurantId, bookingId: id, actorUserId: STAFF })
    expect(await refundDeposit(w.decisionDeps, { ...input(a.booking.id), reason: 'staff' })).toMatchObject({ ok: true, deposit: { status: 'refunded' } })
    expect(await keepDeposit(w.decisionDeps, input(a.booking.id))).toEqual({ ok: false, reason: 'conflict', status: 'refunded' })
    expect(await keepDeposit(w.decisionDeps, input(b.booking.id))).toMatchObject({ ok: true, deposit: { status: 'kept', decidedBy: STAFF } })
    expect(await refundDeposit(w.decisionDeps, { ...input(b.booking.id), reason: 'staff' })).toEqual({ ok: false, reason: 'conflict', status: 'kept' })
    expect(w.gateway.calls.refund).toBe(1)
  })

  it('staff-made hold: paying confirms the booking directly (staff already accepted), 24 h hold', async () => {
    const w = paymentWorld()
    const s = await w.book({ source: 'staff' }, { holder: 'staff' })
    if (s.kind !== 'started') throw new Error(s.kind)
    expect(Date.parse(s.expiresAt) - w.now().getTime()).toBe(24 * 3_600_000)
    await w.deliver(w.gateway.completeSession(s.deposit.providerSessionId!))
    expect(w.ledger.booking(s.booking.id)?.status).toBe('confirmed')
  })
})

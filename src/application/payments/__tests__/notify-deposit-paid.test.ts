// BOOK-014 W3 (spec AC-6): the "received" message for a /b booking goes out on
// the paid event, once; a replayed paid event sends nothing (W1 CAS +
// idempotency). Bookings from other channels are left to their own hooks.
import { describe, it, expect, beforeEach } from 'vitest'
import { bookingPagePaidHook } from '../notify-deposit-paid'
import { paymentWorld, RESTAURANT } from '@/test-utils/payment-world'
import { FakeBookingSender, FakeBookingSettings } from '@/test-utils/fake-booking'

let w: ReturnType<typeof paymentWorld>
let sender: FakeBookingSender

beforeEach(() => {
  w = paymentWorld()
  sender = new FakeBookingSender()
  const settings = new FakeBookingSettings()
  settings.restaurants.set(RESTAURANT, { name: 'Café A', logoUrl: null, whatsappNumber: '+85220000001' })
  w.webhookDeps.onDepositPaid = bookingPagePaidHook({ settings, sender })
})

async function startedSession(source: 'chat' | 'campaign' | 'agent' = 'chat') {
  const s = await w.book({ source })
  if (s.kind !== 'started') throw new Error(s.kind)
  return s
}

describe('W3 AC-6: received message on the paid event', () => {
  it('nothing at submit; one received message after the signed paid event; a replay sends none', async () => {
    const s = await startedSession()
    expect(sender.sent).toEqual([])
    const delivery = w.gateway.completeSession(s.deposit.providerSessionId!)
    await w.deliver(delivery)
    expect(sender.sent).toEqual([
      {
        restaurantId: RESTAURANT, phone: '+85291234567', memberId: null, kind: 'received',
        details: { restaurantName: 'Café A', name: 'Chan', date: '2026-12-24', time: '19:00', partySize: 4 },
      },
    ])
    expect(w.ledger.booking(s.booking.id)?.status).toBe('pending')
    await w.deliver(delivery)
    expect(sender.sent).toHaveLength(1)
  })

  it('a campaign-link booking gets it too', async () => {
    const s = await startedSession('campaign')
    await w.deliver(w.gateway.completeSession(s.deposit.providerSessionId!))
    expect(sender.sent.map((m) => m.kind)).toEqual(['received'])
  })

  it('an agent booking is not this hook\'s to message (W5 owns it)', async () => {
    const s = await startedSession('agent')
    await w.deliver(w.gateway.completeSession(s.deposit.providerSessionId!))
    expect(sender.sent).toEqual([])
  })

  it('a payment after the lapse sends no received message (refunded, booking stays lapsed)', async () => {
    const s = await startedSession()
    w.gateway.completeSession(s.deposit.providerSessionId!) // paid at the provider just before the lapse
    w.advance(31 * 60_000)
    await w.ledger.lapseExpired(10)
    // The provider's redelivery after the lapse, freshly signed.
    const res = await w.deliver(w.gateway.completeSession(s.deposit.providerSessionId!))
    expect(res.body).toEqual({ received: true, outcomes: ['late_refunded'] })
    expect(sender.sent).toEqual([])
  })

  it('a send failure never undoes the payment', async () => {
    const s = await startedSession()
    sender.send = async () => {
      throw new Error('whatsapp down')
    }
    const res = await w.deliver(w.gateway.completeSession(s.deposit.providerSessionId!))
    expect(res.status).toBe(200)
    expect(w.ledger.deposits.get(s.deposit.id)?.status).toBe('paid')
    expect(w.lines.some((l) => l.event === 'deposit.paid_hook_failed')).toBe(true)
  })
})

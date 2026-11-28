// BOOK-014 W6a (W5 merge note D1; spec AC-6, AC-9, AC-10, AC-11): the one
// paid-event hook the webhook runs composes the booking page's (W3) and the
// agent / staff (W5) hooks. Through the real webhook processing on the test
// provider adapter, every paid booking source gets exactly one diner message:
// booking page (chat link), campaign link, AI agent and personal agent ->
// "received"; staff-created -> "confirmed". A replayed event sends nothing.
import { describe, it, expect } from 'vitest'
import { FakeBookingSender, FakeBookingSettings } from '@/test-utils/fake-booking'
import { paymentWorld, RESTAURANT, PER_GUEST_100 } from '@/test-utils/payment-world'
import type { BookingSource, DecisionMessageStatus } from '@/domain/entities/booking-request'
import { startDeposit } from '../start-deposit'
import { processPaymentWebhook } from '../process-payment-webhook'
import { depositPaidHook } from '../deposit-paid-hook'

function setup() {
  const w = paymentWorld()
  const settings = new FakeBookingSettings()
  settings.restaurants.set(RESTAURANT, { name: 'Café A', logoUrl: null, whatsappNumber: null })
  const sender = new FakeBookingSender()
  const recorded: Array<{ id: string; status: DecisionMessageStatus }> = []
  const hook = depositPaidHook({ settings, sender, recordMessage: async (id, _r, status) => void recorded.push({ id, status }) })
  const deliver = (d: Parameters<typeof processPaymentWebhook>[1]) => processPaymentWebhook({ ...w.webhookDeps, onDepositPaid: hook }, d)
  return { w, sender, recorded, deliver }
}

async function staffHold(w: ReturnType<typeof paymentWorld>) {
  let bookingId = ''
  const started = await startDeposit(w.startDeps, {
    restaurantId: RESTAURANT, rule: PER_GUEST_100, account: w.account, partySize: 2, holder: 'staff', restaurantName: 'Café A',
    bookingDate: '2026-12-24', bookingTime: '19:00',
    insertBooking: async (hold) => {
      const seeded = w.ledger.seedStaffHold({ restaurantId: RESTAURANT, createdBy: 'staff-1', hold })
      bookingId = seeded.booking.id
      w.ledger.bookings.set(bookingId, { ...seeded.booking, notifyDiner: true })
      return { ok: true as const, booking: { ...seeded.booking, notifyDiner: true }, deposit: seeded.deposit }
    },
  })
  if (started.kind !== 'started') throw new Error(started.kind)
  return { bookingId, sessionRef: started.deposit.providerSessionId! }
}

/** Pays one diner-channel booking of `source` twice (the second delivery is the replay). */
async function payTwice(source: BookingSource) {
  const { w, sender, recorded, deliver } = setup()
  const started = await w.book({ source })
  if (started.kind !== 'started') throw new Error(started.kind)
  const delivery = w.gateway.completeSession(started.deposit.providerSessionId!)
  await deliver(delivery)
  await deliver(delivery)
  return { w, sender, recorded, bookingId: started.booking.id }
}

describe('W6a composed paid hook: one diner message per source, replay none', () => {
  it('booking page (chat link): pending + "received" once', async () => {
    const { w, sender, bookingId } = await payTwice('chat')
    expect(w.ledger.booking(bookingId)?.status).toBe('pending')
    expect(sender.sent.map((m) => m.kind)).toEqual(['received'])
  })

  it('campaign link: pending + "received" once', async () => {
    const { sender } = await payTwice('campaign')
    expect(sender.sent.map((m) => m.kind)).toEqual(['received'])
  })

  it('AI agent and personal agent (source agent): pending + "received" once', async () => {
    const { w, sender, bookingId } = await payTwice('agent')
    expect(w.ledger.booking(bookingId)?.status).toBe('pending')
    expect(sender.sent.map((m) => [m.kind, m.phone])).toEqual([['received', '+85291234567']])
  })

  it('staff-created: confirmed + "confirmed" once, outcome recorded; replay none', async () => {
    const { w, sender, recorded, deliver } = setup()
    const { bookingId, sessionRef } = await staffHold(w)
    const delivery = w.gateway.completeSession(sessionRef)
    await deliver(delivery)
    await deliver(delivery)
    expect(w.ledger.booking(bookingId)?.status).toBe('confirmed')
    expect(sender.sent.map((m) => m.kind)).toEqual(['confirmed'])
    expect(recorded).toEqual([{ id: bookingId, status: 'delivered' }])
  })

  it('all four sources paid in one world: four messages, one each; replaying all sends none', async () => {
    const { w, sender, deliver } = setup()
    const chat = await w.book({ source: 'chat', phone: '+85291000001', partySize: 2 })
    const campaign = await w.book({ source: 'campaign', phone: '+85291000002', partySize: 2 })
    const agent = await w.book({ source: 'agent', phone: '+85291000003', partySize: 2 })
    if (chat.kind !== 'started' || campaign.kind !== 'started' || agent.kind !== 'started') throw new Error('not started')
    const staff = await staffHold(w)
    const deliveries = [chat, campaign, agent].map((s) => w.gateway.completeSession(s.deposit.providerSessionId!))
    deliveries.push(w.gateway.completeSession(staff.sessionRef))
    for (const d of deliveries) await deliver(d)
    expect(sender.sent.map((m) => [m.kind, m.phone])).toEqual([
      ['received', '+85291000001'],
      ['received', '+85291000002'],
      ['received', '+85291000003'],
      ['confirmed', '+85290000000'],
    ])
    for (const d of deliveries) await deliver(d)
    expect(sender.sent).toHaveLength(4)
  })
})

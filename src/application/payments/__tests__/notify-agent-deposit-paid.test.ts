// BOOK-014 W5 (spec AC-9, AC-10, AC-11; W4 open item): the paid-event hook of
// the agent and staff channels, through the real webhook processing on the
// test provider adapter. Agent bookings get "received" once (now pending);
// a staff hold that is paid (now confirmed) gets the "confirmed" message staff
// create sends, only with Notify on; the booking page's sources are W3's.
import { describe, it, expect } from 'vitest'
import { FakeBookingSender, FakeBookingSettings } from '@/test-utils/fake-booking'
import { paymentWorld, RESTAURANT } from '@/test-utils/payment-world'
import type { DecisionMessageStatus } from '@/domain/entities/booking-request'
import { startDeposit } from '../start-deposit'
import { processPaymentWebhook } from '../process-payment-webhook'
import { agentAndStaffPaidHook } from '../notify-agent-deposit-paid'

function setup() {
  const w = paymentWorld()
  const settings = new FakeBookingSettings()
  settings.restaurants.set(RESTAURANT, { name: 'Café A', logoUrl: null, whatsappNumber: null })
  const sender = new FakeBookingSender()
  const recorded: Array<{ id: string; status: DecisionMessageStatus }> = []
  const hook = agentAndStaffPaidHook({ settings, sender, recordMessage: async (id, _r, status) => void recorded.push({ id, status }) })
  const deliver = (d: Parameters<typeof processPaymentWebhook>[1]) => processPaymentWebhook({ ...w.webhookDeps, onDepositPaid: hook }, d)
  return { w, sender, recorded, deliver }
}

/** A staff hold as 097 staff_create_deposit_booking writes it, with its session started by startDeposit. */
async function staffHold(w: ReturnType<typeof paymentWorld>, notifyDiner: boolean) {
  let bookingId = ''
  const started = await startDeposit(w.startDeps, {
    restaurantId: RESTAURANT, rule: { enabled: true, mode: 'per_guest', amount: 100, fromPartySize: 1, refundNote: { zh_hk: '', en: '' } },
    account: w.account, partySize: 2, holder: 'staff', restaurantName: 'Café A', bookingDate: '2026-12-24', bookingTime: '19:00',
    insertBooking: async (hold) => {
      const seeded = w.ledger.seedStaffHold({ restaurantId: RESTAURANT, createdBy: 'staff-1', hold })
      bookingId = seeded.booking.id
      w.ledger.bookings.set(bookingId, { ...seeded.booking, notifyDiner })
      return { ok: true as const, booking: { ...seeded.booking, notifyDiner }, deposit: seeded.deposit }
    },
  })
  if (started.kind !== 'started') throw new Error(started.kind)
  return { bookingId, sessionRef: started.deposit.providerSessionId! }
}

describe('paid hook: agent and staff channels', () => {
  it('staff hold paid -> confirmed, the "confirmed" message once, its outcome stored; replay sends nothing', async () => {
    const { w, sender, recorded, deliver } = setup()
    const { bookingId, sessionRef } = await staffHold(w, true)
    const delivery = w.gateway.completeSession(sessionRef)
    await deliver(delivery)
    await deliver(delivery)
    expect(w.ledger.booking(bookingId)?.status).toBe('confirmed')
    expect(sender.sent.map((m) => m.kind)).toEqual(['confirmed'])
    expect(sender.sent[0]).toMatchObject({ restaurantId: RESTAURANT, phone: '+85290000000', details: { restaurantName: 'Café A', partySize: 2 } })
    expect(recorded).toEqual([{ id: bookingId, status: 'delivered' }])
  })

  it('staff hold with Notify off -> confirmed, no message', async () => {
    const { w, sender, recorded, deliver } = setup()
    const { sessionRef } = await staffHold(w, false)
    await deliver(w.gateway.completeSession(sessionRef))
    expect(sender.sent).toEqual([])
    expect(recorded).toEqual([])
  })

  it('agent booking paid -> pending + "received"; a booking page (chat) booking is left to W3', async () => {
    const { w, sender, deliver } = setup()
    const agent = await w.book({ source: 'agent' })
    const chat = await w.book({ source: 'chat', phone: '+85291111111' })
    if (agent.kind !== 'started' || chat.kind !== 'started') throw new Error('not started')
    await deliver(w.gateway.completeSession(agent.deposit.providerSessionId!))
    await deliver(w.gateway.completeSession(chat.deposit.providerSessionId!))
    expect(sender.sent.map((m) => [m.kind, m.phone])).toEqual([['received', '+85291234567']])
  })

  it('a send failure never undoes the payment (logged by the caller)', async () => {
    const { w, deliver, sender } = setup()
    sender.send = async () => {
      throw new Error('kapso down')
    }
    const agent = await w.book({ source: 'agent' })
    if (agent.kind !== 'started') throw new Error('not started')
    expect((await deliver(w.gateway.completeSession(agent.deposit.providerSessionId!))).status).toBe(200)
    expect(w.ledger.booking(agent.booking.id)?.status).toBe('pending')
    expect(w.lines.some((l) => l.event === 'deposit.paid_hook_failed')).toBe(true)
  })
})


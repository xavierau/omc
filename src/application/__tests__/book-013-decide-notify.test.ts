// BOOK-013 review R2: staff who unticked Notify (spec AC-2) get no confirm or
// decline message for that booking and no message outcome. Notify on (or
// unset on an older row) sends the confirmation exactly as BOOK-001 does
// (spec decision 8: no check-in code or QR in it).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { decideBookingRequest, type DecideBookingDeps } from '../booking/decide-booking-request'
import { FakeBookingRequests, FakeBookingSender, FakeBookingSettings } from '@/test-utils/fake-booking'

const A = 'rest-a'
const NOW = new Date('2026-11-26T03:00:00.000Z')

describe('decide with Notify (review R2)', () => {
  let requests: FakeBookingRequests
  let sender: FakeBookingSender
  let deps: DecideBookingDeps

  beforeEach(() => {
    requests = new FakeBookingRequests()
    sender = new FakeBookingSender()
    const settings = new FakeBookingSettings()
    settings.restaurants.set(A, { name: 'Kushiro', logoUrl: null, whatsappNumber: null })
    deps = { requests, settings, sender, now: () => NOW }
  })

  const seed = async () =>
    (await requests.insert({ restaurantId: A, memberId: null, phone: '+85291234567', name: 'Chan', partySize: 2, bookingDate: '2026-11-28',
      bookingTime: '19:30', notes: 'allergy', source: 'chat', campaignId: null, token: null })).id

  it('Notify off → confirmed, but no message and no message outcome stored', async () => {
    const id = await seed()
    requests.rows[0].notifyDiner = false
    const recordSpy = vi.spyOn(requests, 'recordDecisionMessage')
    const result = await decideBookingRequest(deps, { restaurantId: A, userId: 'u', bookingId: id, decision: 'confirmed' })
    expect(result).toMatchObject({ ok: true, delivered: null, booking: { status: 'confirmed' } })
    expect(sender.sent).toEqual([])
    expect(recordSpy).not.toHaveBeenCalled()
    expect(requests.rows[0].decisionMessageStatus).toBeNull()
  })

  it('Notify off → a decline is not sent either', async () => {
    const id = await seed()
    requests.rows[0].notifyDiner = false
    const result = await decideBookingRequest(deps, { restaurantId: A, userId: 'u', bookingId: id, decision: 'declined', reason: 'Full' })
    expect(result).toMatchObject({ ok: true, delivered: null, booking: { status: 'declined' } })
    expect(sender.sent).toEqual([])
  })

  it.each([[true], [undefined]])('Notify %s → the BOOK-001 confirmation (no code, no image) is sent and its outcome stored', async (notify) => {
    const id = await seed()
    requests.rows[0].notifyDiner = notify
    const result = await decideBookingRequest(deps, { restaurantId: A, userId: 'u', bookingId: id, decision: 'confirmed' })
    expect(result).toMatchObject({ ok: true, delivered: true })
    expect(sender.sent).toEqual([{
      restaurantId: A, phone: '+85291234567', memberId: null, kind: 'confirmed',
      details: { restaurantName: 'Kushiro', name: 'Chan', date: '2026-11-28', time: '19:30', partySize: 2, declineReason: null },
    }])
    expect(requests.rows[0].decisionMessageStatus).toBe('delivered')
  })
})

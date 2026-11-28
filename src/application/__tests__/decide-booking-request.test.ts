import { describe, it, expect, beforeEach, vi } from 'vitest'
import { decideBookingRequest, type DecideBookingDeps } from '../booking/decide-booking-request'
import { FakeBookingRequests, FakeBookingSender, FakeBookingSettings } from '@/test-utils/fake-booking'

const A = 'rest-a'
const B = 'rest-b'
const NOW = new Date('2026-11-12T03:00:00.000Z')

let requests: FakeBookingRequests
let sender: FakeBookingSender
let deps: DecideBookingDeps
let idA: string
let idB: string

async function seed(restaurantId: string, token: string) {
  const row = await requests.insert({
    restaurantId, memberId: null, phone: '+85291234567', name: 'Chan', partySize: 2, bookingDate: '2026-11-13',
    bookingTime: '19:30', notes: null, source: 'chat', campaignId: null, token,
  })
  return row.id
}

beforeEach(async () => {
  requests = new FakeBookingRequests()
  sender = new FakeBookingSender()
  const settings = new FakeBookingSettings()
  settings.restaurants.set(A, { name: 'Kushiro', logoUrl: null, whatsappNumber: null })
  deps = { requests, settings, sender, now: () => NOW }
  idA = await seed(A, 'tok-a')
  idB = await seed(B, 'tok-b')
})

const decide = (bookingId: string, decision: 'confirmed' | 'declined', restaurantId = A, reason?: unknown) =>
  decideBookingRequest(deps, { restaurantId, userId: 'user-a', bookingId, decision, reason })

describe('decideBookingRequest', () => {
  it('R4: two confirms on one request change status once and send once; the second is already handled', async () => {
    const results = await Promise.all([decide(idA, 'confirmed'), decide(idA, 'confirmed')])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.find((r) => !r.ok)).toEqual({ ok: false, reason: 'already_handled', status: 'confirmed' })
    expect(sender.sent).toHaveLength(1)
    expect(sender.sent[0].kind).toBe('confirmed')
  })

  it('R5: stores decided_by = the acting user and decided_at', async () => {
    await decide(idA, 'confirmed')
    expect(requests.rows[0]).toMatchObject({ status: 'confirmed', decidedBy: 'user-a', decidedAt: NOW.toISOString() })
  })

  it('R5: a decline stores who, when and the normalised reason, and sends the decline message', async () => {
    const result = await decide(idA, 'declined', A, '  Fully\nbooked ')
    expect(result.ok).toBe(true)
    expect(requests.rows[0]).toMatchObject({ status: 'declined', decidedBy: 'user-a', declineReason: 'Fully booked' })
    expect(sender.sent[0]).toMatchObject({ kind: 'declined', details: { declineReason: 'Fully booked', restaurantName: 'Kushiro' } })
  })

  it("R6: tenant A acting on tenant B's booking gets not_found and B is unchanged", async () => {
    for (const decision of ['confirmed', 'declined'] as const) {
      expect(await decide(idB, decision)).toEqual({ ok: false, reason: 'not_found' })
    }
    expect(requests.rows[1]).toMatchObject({ status: 'pending', decidedBy: null })
    expect(sender.sent).toHaveLength(0)
  })

  it('treats a malformed id as not found without a query', async () => {
    expect(await decide('1; drop table', 'confirmed')).toEqual({ ok: false, reason: 'not_found' })
  })

  it('AC-14 warning: status saved even when the message is not delivered', async () => {
    sender.result = { delivered: false, reason: 'outside_window' }
    const result = await decide(idA, 'confirmed')
    expect(result).toMatchObject({ ok: true, delivered: false, booking: { status: 'confirmed' } })
    expect(requests.rows[0].status).toBe('confirmed')
  })

  // F9 (review #7): the outcome is stored so the badge survives a reload.
  it('stores not_delivered / delivered on the booking and returns it', async () => {
    sender.result = { delivered: false, reason: 'outside_window' }
    expect(await decide(idA, 'confirmed')).toMatchObject({ booking: { decisionMessageStatus: 'not_delivered' } })
    expect(requests.rows[0].decisionMessageStatus).toBe('not_delivered')
    sender.result = { delivered: true, via: 'text' }
    const idA2 = await seed(A, 'tok-a2')
    await decide(idA2, 'declined')
    expect(requests.rows.find((r) => r.id === idA2)?.decisionMessageStatus).toBe('delivered')
  })

  it('a failure to store the outcome never fails the decision', async () => {
    requests.failRecordDecisionMessage = true
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await decide(idA, 'confirmed')).toMatchObject({ ok: true, delivered: true })
    expect(requests.rows[0].status).toBe('confirmed')
  })
})

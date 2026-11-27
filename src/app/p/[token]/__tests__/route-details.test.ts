// BOOK-014 W3 (spec AC-5, AC-6, AC-7, UI states; threat R62, R64): the /p
// return pages for a live link show the restaurant, date, time, party and
// amount only (never the diner's name, phone or notes): paid -> "Deposit
// paid, request sent" (booking-pay-paid); back without paying, hold open ->
// "Payment not finished, you have until HH:MM" + Pay now to the same /p link
// (booking-pay-pending); lapsed and unknown stay neutral (no details).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { paymentWorld } from '@/test-utils/payment-world'
import type { ResolvePaymentLinkDeps } from '@/application/payments/resolve-payment-link'

const holder = vi.hoisted(() => ({ deps: null as unknown }))
vi.mock('@/application/payments/payment-deps', () => ({ paymentLinkDeps: () => holder.deps }))

import { GET } from '../route'

let w: ReturnType<typeof paymentWorld>

beforeEach(() => {
  w = paymentWorld()
  const deps: ResolvePaymentLinkDeps = {
    ...w.linkDeps,
    details: {
      async find({ restaurantId, bookingId }) {
        const b = w.ledger.booking(bookingId)
        return b && b.restaurantId === restaurantId
          ? { restaurantName: 'Café A', bookingDate: b.bookingDate, bookingTime: b.bookingTime, partySize: b.partySize }
          : null
      },
    },
  }
  holder.deps = deps
})

const get = (token: string, query = '') => GET(new NextRequest(`http://localhost/p/${token}${query}`), { params: Promise.resolve({ token }) })

async function started(over: Parameters<typeof w.book>[0] = {}) {
  const s = await w.book({ notes: 'peanut allergy', ...over })
  if (s.kind !== 'started') throw new Error(s.kind)
  return { s, token: w.tokens[w.tokens.length - 1] }
}

const PII = ['Chan', '+852', '91234567', 'peanut allergy', 'acct_']

function expectDetails(html: string) {
  for (const shown of ['Café A', '2026-12-24', '19:00', 'HK$400']) expect(html).toContain(shown)
  expect(html).toMatch(/4 位|4 guests/)
  for (const hidden of PII) expect(html).not.toContain(hidden)
}

describe('W3 /p pages with booking details', () => {
  it('paid -> "Deposit paid, request sent" (booking-pay-paid) with the details, no PII', async () => {
    const { s, token } = await started()
    await w.deliver(w.gateway.completeSession(s.deposit.providerSessionId!))
    const res = await get(token)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Deposit paid, request sent')
    expect(html).toContain('data-testid="booking-pay-paid"')
    expectDetails(html)
  })

  it('back from the provider after paying, before the webhook -> "confirming" with the details', async () => {
    const { token } = await started()
    const html = await (await get(token, '?return=success')).text()
    expect(html).toContain('Confirming your payment')
    expectDetails(html)
  })

  it('back without paying, hold open -> "Payment not finished, you have until HH:MM" + Pay now to the same /p link', async () => {
    const { token } = await started()
    const html = await (await get(token, '?return=cancel')).text()
    expect(html).toContain('data-testid="booking-pay-pending"')
    expect(html).toContain('Payment not finished')
    expect(html).toContain('You have until 18:30') // 10:00Z + 30 min = 18:30 Hong Kong
    expect(html).toContain(`href="/p/${token}"`)
    expect(html).toContain('data-testid="booking-pay-now"')
    expectDetails(html)
  })

  it('lapsed -> "This hold has lapsed, message us on WhatsApp", neutral (no details)', async () => {
    const { token } = await started()
    w.advance(31 * 60_000)
    const res = await get(token)
    expect(res.status).toBe(410)
    const html = await res.text()
    expect(html).toContain('data-testid="booking-pay-lapsed"')
    expect(html).toContain('message us on WhatsApp')
    for (const hidden of ['Café A', '2026-12-24', '19:00', 'HK$400', ...PII]) expect(html).not.toContain(hidden)
  })

  it('unknown token -> neutral 404, the details reader is never asked', async () => {
    const find = vi.spyOn((holder.deps as ResolvePaymentLinkDeps).details!, 'find')
    const res = await get('Z'.repeat(43))
    expect(res.status).toBe(404)
    expect(find).not.toHaveBeenCalled()
  })

  it('a details read failure still answers the state, neutral, with no error text (R64)', async () => {
    const { token } = await started()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn((holder.deps as ResolvePaymentLinkDeps).details!, 'find').mockRejectedValueOnce(new Error('db acct_123 exploded'))
    const res = await get(token, '?return=cancel')
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Payment not finished')
    for (const hidden of ['exploded', 'acct_', 'Café A']) expect(html).not.toContain(hidden)
  })
})

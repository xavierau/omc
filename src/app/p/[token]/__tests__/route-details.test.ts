// BOOK-014 W3 (spec AC-5, AC-6, AC-7, UI states; threat R62, R64): the /p
// return pages for a live link show the restaurant, date, time, party and
// amount only (never the diner's name, phone or notes): paid -> "Deposit
// paid, request sent" (booking-pay-paid); back without paying, hold open ->
// "Payment not finished, you have until HH:MM" + Pay now to the same /p link
// (booking-pay-pending); lapsed and unknown stay neutral (no details).
// r2: a refunded deposit (refund_pending / refunded / refund_failed) says it is
// being / has been refunded (booking-pay-refunded), never "request sent"; a
// kept one is a neutral closed page (booking-pay-closed).
// W6a: a cancelled or no-show booking whose paid deposit still awaits the
// staff decision reads "your deposit is held; the restaurant will decide on
// it" (booking-pay-held), never "request sent".
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
      async findForDeposit({ restaurantId, bookingId }) {
        const b = w.ledger.booking(bookingId)
        return b && b.restaurantId === restaurantId
          ? { bookingDate: b.bookingDate, bookingTime: b.bookingTime, partySize: b.partySize, bookingStatus: b.status }
          : null
      },
    },
    restaurants: { getRestaurant: async (id) => (id === 'rest-a' ? { name: 'Café A', logoUrl: null, whatsappNumber: '+85220000001' } : null) },
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
    await w.ledger.lapseExpired(200) // W6-fix F3: lapsed only once the lapse ran (before: checking)
    const res = await get(token)
    expect(res.status).toBe(410)
    const html = await res.text()
    expect(html).toContain('data-testid="booking-pay-lapsed"')
    expect(html).toContain('message us on WhatsApp')
    for (const hidden of ['Café A', '2026-12-24', '19:00', 'HK$400', ...PII]) expect(html).not.toContain(hidden)
  })

  it('unknown token -> neutral 404, the details reader is never asked', async () => {
    const find = vi.spyOn((holder.deps as ResolvePaymentLinkDeps).details!, 'findForDeposit')
    const res = await get('Z'.repeat(43))
    expect(res.status).toBe(404)
    expect(find).not.toHaveBeenCalled()
  })

  it('a details read failure still answers the state, neutral, with no error text (R64)', async () => {
    const { token } = await started()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn((holder.deps as ResolvePaymentLinkDeps).details!, 'findForDeposit').mockRejectedValueOnce(new Error('db acct_123 exploded'))
    const res = await get(token, '?return=cancel')
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Payment not finished')
    for (const hidden of ['exploded', 'acct_', 'Café A']) expect(html).not.toContain(hidden)
  })
})

describe('W3 r2: refunded and kept deposits never read "request sent"', () => {
  async function paid() {
    const { s, token } = await started()
    await w.deliver(w.gateway.completeSession(s.deposit.providerSessionId!))
    return { s, token }
  }

  it.each(['refund_pending', 'refunded', 'refund_failed'] as const)('%s -> "being / has been refunded" (booking-pay-refunded), zh-HK + en', async (status) => {
    const { s, token } = await paid()
    Object.assign(w.ledger.deposits.get(s.deposit.id)!, { status, refundReason: 'declined' })
    const res = await get(token)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('data-testid="booking-pay-refunded"')
    expect(html).toContain('訂金退款')
    expect(html).toContain('Your deposit is being refunded or has been refunded')
    expect(html).not.toContain('request sent')
    expect(html).not.toContain('訂座要求已送出')
    expect(html).not.toContain('refund failed')
    expectDetails(html)
  })

  it('kept -> neutral closed page (booking-pay-closed), no details', async () => {
    const { s, token } = await paid()
    Object.assign(w.ledger.deposits.get(s.deposit.id)!, { status: 'kept', decidedAt: new Date().toISOString() })
    const res = await get(token)
    const html = await res.text()
    expect(html).toContain('data-testid="booking-pay-closed"')
    expect(html).toContain('This booking is closed, message us on WhatsApp')
    expect(html).toContain('此訂座已結束')
    expect(html).not.toContain('request sent')
    for (const hidden of ['Café A', '2026-12-24', '19:00', 'HK$400', ...PII]) expect(html).not.toContain(hidden)
  })

  it('a late payment refund still reads as lapsed (unchanged)', async () => {
    const { s, token } = await paid()
    Object.assign(w.ledger.deposits.get(s.deposit.id)!, { status: 'refunded', refundReason: 'late_payment' })
    expect(await (await get(token)).text()).toContain('data-testid="booking-pay-lapsed"')
  })
})

describe('W6a: a cancelled or no-show booking with a paid deposit awaiting the staff decision', () => {
  async function paidThen(status: 'cancelled' | 'no_show' | 'declined' | 'confirmed') {
    const { s, token } = await started()
    await w.deliver(w.gateway.completeSession(s.deposit.providerSessionId!))
    Object.assign(w.ledger.bookings.get(s.booking.id)!, { status })
    return token
  }

  it.each(['cancelled', 'no_show'] as const)('%s -> "Your deposit is held; the restaurant will decide on it" (booking-pay-held), zh-HK + en, with the details', async (status) => {
    const token = await paidThen(status)
    const res = await get(token)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('data-testid="booking-pay-held"')
    expect(html).toContain('Your deposit is held; the restaurant will decide on it.')
    expect(html).toContain('你的訂金暫由餐廳保留，餐廳會決定如何處理。')
    expect(html).not.toContain('request sent')
    expect(html).not.toContain('訂座要求已送出')
    expectDetails(html)
  })

  it('a confirmed booking with a paid deposit still reads "Deposit paid" (unchanged)', async () => {
    const html = await (await get(await paidThen('confirmed'))).text()
    expect(html).toContain('data-testid="booking-pay-paid"')
  })

  it('a refunded or kept deposit on a cancelled booking keeps its own state (W3)', async () => {
    const { s, token } = await started()
    await w.deliver(w.gateway.completeSession(s.deposit.providerSessionId!))
    Object.assign(w.ledger.bookings.get(s.booking.id)!, { status: 'cancelled' })
    Object.assign(w.ledger.deposits.get(s.deposit.id)!, { status: 'refunded', refundReason: 'staff' })
    expect(await (await get(token)).text()).toContain('data-testid="booking-pay-refunded"')
    Object.assign(w.ledger.deposits.get(s.deposit.id)!, { status: 'kept' })
    expect(await (await get(token)).text()).toContain('data-testid="booking-pay-closed"')
  })
})

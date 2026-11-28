// BOOK-014 W6-fix (PR #237 /code-review F3; W6a gaps G2, G3): /p never tells
// a diner something the money does not back.
// F3: an awaiting deposit past its hold is not lapsed yet (the lapse cron runs
//     every 5 minutes and a payment Stripe accepts meanwhile counts as paid):
//     a neutral "Checking your payment…" page, never "will be refunded". The
//     lapsed page shows only once the deposit IS lapsed. ?return=success on an
//     awaiting deposit past the hold reads the same.
// G2: a declined booking whose paid deposit has not started its refund reads
//     "Your deposit will be refunded", never "Deposit paid".
// G3: a paid deposit whose details read fails reads "We couldn't load this
//     payment, please message us on WhatsApp", never "Deposit paid".
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { paymentWorld } from '@/test-utils/payment-world'
import { expireDeposits } from '@/application/payments/expire-deposits'
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

async function started() {
  const s = await w.book({ notes: 'peanut allergy' })
  if (s.kind !== 'started') throw new Error(s.kind)
  return { s, token: w.tokens[w.tokens.length - 1] }
}

const REFUND_PROMISE = ['will be refunded', '將會全數退回', 'refunded in full']

describe('F3: an awaiting deposit past its hold, before the lapse runs', () => {
  it.each(['', '?return=success', '?return=cancel'])('F3 /p awaiting past the hold%s -> checking state, never "will be refunded"', async (query) => {
    const { s, token } = await started()
    w.advance(31 * 60_000)
    expect(w.ledger.deposits.get(s.deposit.id)!.status).toBe('awaiting')
    const res = await get(token, query)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('data-testid="booking-pay-checking"')
    expect(html).toContain('Checking your payment…')
    expect(html).toContain('正在核對你的付款…')
    for (const promise of REFUND_PROMISE) expect(html).not.toContain(promise)
    expect(html).not.toContain('booking-pay-lapsed')
    expect(html).not.toContain('booking-pay-now')
    expect(res.headers.get('location')).toBeNull()
  })

  it('F3 a payment Stripe accepted in that window is paid (seats were held), and /p then reads paid', async () => {
    const { s, token } = await started()
    w.advance(31 * 60_000)
    await w.deliver(w.gateway.completeSession(s.deposit.providerSessionId!))
    expect(w.ledger.deposits.get(s.deposit.id)!.status).toBe('paid')
    expect(await (await get(token)).text()).toContain('data-testid="booking-pay-paid"')
  })

  it('F3 the lapsed page shows only once the deposit is actually lapsed', async () => {
    const { s, token } = await started()
    w.advance(31 * 60_000)
    await expireDeposits(w.expireDeps)
    expect(w.ledger.deposits.get(s.deposit.id)!.status).toBe('lapsed')
    const res = await get(token, '?return=success')
    expect(res.status).toBe(410)
    expect(await res.text()).toContain('data-testid="booking-pay-lapsed"')
  })

  it('F3 within the hold, ?return=success still reads "Confirming your payment" (unchanged)', async () => {
    const { token } = await started()
    expect(await (await get(token, '?return=success')).text()).toContain('Confirming your payment')
  })
})

describe('G2: a declined booking whose paid deposit has not started its refund', () => {
  it('G2 declined + paid -> "Your deposit will be refunded" (booking-pay-refund-due), never "Deposit paid"', async () => {
    const { s, token } = await started()
    await w.deliver(w.gateway.completeSession(s.deposit.providerSessionId!))
    w.ledger.setBookingStatus(s.booking.id, 'declined')
    expect(w.ledger.deposits.get(s.deposit.id)!.status).toBe('paid')
    const res = await get(token)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('data-testid="booking-pay-refund-due"')
    expect(html).toContain('Your deposit will be refunded')
    expect(html).toContain('你的訂金將會退回')
    expect(html).not.toContain('Deposit paid')
    expect(html).not.toContain('request sent')
    expect(html).toContain('HK$400')
  })
})

describe('G3: the details read fails on a paid deposit', () => {
  it('G3 details read throws -> "We couldn’t load this payment" (booking-pay-unreadable), never "Deposit paid"', async () => {
    const { s, token } = await started()
    await w.deliver(w.gateway.completeSession(s.deposit.providerSessionId!))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn((holder.deps as ResolvePaymentLinkDeps).details!, 'findForDeposit').mockRejectedValueOnce(new Error('db acct_123 exploded'))
    const res = await get(token)
    const html = await res.text()
    expect(html).toContain('data-testid="booking-pay-unreadable"')
    expect(html).toContain('We couldn’t load this payment, please message us on WhatsApp.')
    expect(html).toContain('未能載入此付款資料，請在 WhatsApp 聯絡我們。')
    for (const hidden of ['Deposit paid', 'request sent', 'exploded', 'acct_', 'Café A']) expect(html).not.toContain(hidden)
    expect(w.lines.some((l) => l.event === 'payment_link.details_failed')).toBe(true)
  })

  it('G3 the details read finds no booking -> the same neutral state', async () => {
    const { s, token } = await started()
    await w.deliver(w.gateway.completeSession(s.deposit.providerSessionId!))
    vi.spyOn((holder.deps as ResolvePaymentLinkDeps).details!, 'findForDeposit').mockResolvedValueOnce(null)
    expect(await (await get(token)).text()).toContain('data-testid="booking-pay-unreadable"')
  })
})

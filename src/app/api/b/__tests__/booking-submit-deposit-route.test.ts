// BOOK-014 W3 (spec AC-5, UI states; threat R53, R54, R64): POST /api/b/<token>
// when a deposit applies. 200 {ok, redirect: /p/<token>}; a provider failure
// 503 {error: 'payment_unavailable'} with no provider text; a client amount 400.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { FakeBookingRequests, FakeBookingSender, FakeBookingSettings, FakeBookingTokens } from '@/test-utils/fake-booking'
import { FakeRateLimiter } from '@/test-utils/fake-rate-limiter'
import { FakeClock } from '@/test-utils/fake-clock'
import { APP_URL, PER_GUEST_100, RESTAURANT, paymentWorld } from '@/test-utils/payment-world'
import { PaymentGatewayError } from '@/domain/ports/payment-gateway'
import type { SubmitBookingDeps } from '@/application/booking/submit-booking-request'

const holder: { deps: SubmitBookingDeps | null } = { deps: null }
vi.mock('@/application/booking/booking-deps', () => ({ submitBookingDeps: () => holder.deps }))

import { POST } from '../[token]/route'

const TOKEN = 'A'.repeat(43)
const NOW = new Date('2026-12-01T02:00:00.000Z')
const BODY = { date: '2026-12-24', time: '19:00', partySize: 4, name: 'Chan Tai Man', notes: null }

let w: ReturnType<typeof paymentWorld>
let sender: FakeBookingSender

beforeEach(() => {
  vi.restoreAllMocks()
  w = paymentWorld(NOW)
  const tokens = new FakeBookingTokens()
  tokens.add({ token: TOKEN, restaurantId: RESTAURANT, phone: '+85291234567' })
  const settings = new FakeBookingSettings()
  settings.setConfig(RESTAURANT, { mode: 'simple', deposit: PER_GUEST_100 })
  sender = new FakeBookingSender()
  const clock = new FakeClock(NOW)
  holder.deps = {
    tokens, requests: new FakeBookingRequests(), settings, members: { findMemberId: async () => null }, sender,
    limiter: new FakeRateLimiter(clock), now: () => clock.now(),
    deposit: { accounts: w.accounts, writer: w.ledger, start: w.startDeps },
  }
})

function post(body: unknown) {
  const req = new NextRequest(`https://app.ohmyclient.io/api/b/${TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-real-ip': '203.0.113.9' },
    body: JSON.stringify(body),
  })
  return POST(req, { params: Promise.resolve({ token: TOKEN }) })
}

describe('POST /api/b/<token> with a deposit', () => {
  it('200 {ok, redirect} to the /p link; the no-store booking headers; no received message', async () => {
    const res = await post(BODY)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, redirect: `${APP_URL}/p/${w.tokens[0]}` })
    expect(res.headers.get('Cache-Control')).toContain('no-store')
    expect(sender.sent).toEqual([])
  })

  it('R54/R64: provider failure -> 503 payment_unavailable; the provider message and account id never in the body', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(w.gateway, 'createHostedPayment').mockRejectedValueOnce(
      new PaymentGatewayError('unavailable', 'No such account: acct_1SecretXyz; request req_abc failed')
    )
    const res = await post(BODY)
    expect(res.status).toBe(503)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ error: 'payment_unavailable' })
    for (const leak of ['acct_', 'req_abc', 'No such account']) expect(text).not.toContain(leak)
    expect(w.ledger.guests('2026-12-24', '19:00')).toBe(0)
  })

  it('R53: a body carrying an amount or deposit field -> 400 invalid, nothing written', async () => {
    for (const extra of [{ amount: 1 }, { deposit: { amountMinor: 1 } }]) {
      const res = await post({ ...BODY, ...extra })
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('invalid')
    }
    expect(w.ledger.bookings.size).toBe(0)
  })
})

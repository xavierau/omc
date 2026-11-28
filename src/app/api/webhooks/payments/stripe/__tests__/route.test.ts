// BOOK-014 (threat R47, R48): POST /api/webhooks/payments/stripe with the
// REAL Stripe adapter (signatures from the SDK's generateTestHeaderString) and
// the deposit store / idempotency stubbed at the repository boundary.
// R47: unset secret -> 500 and the deposit store is never called; no header ->
// 400; bad signature -> 400; valid signature -> 200.
// R48: oversize body -> 413 with no verify call.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import Stripe from 'stripe'

const store = vi.hoisted(() => ({
  findBySession: vi.fn(), findByPaymentRef: vi.fn(), findByLinkTokenHash: vi.fn(), findByBookingForRestaurant: vi.fn(),
  attachSession: vi.fn(), abandon: vi.fn(), markPaid: vi.fn(), lapseExpired: vi.fn(), beginRefund: vi.fn(),
  finishRefund: vi.fn(), recordRefundRef: vi.fn(), listStalledRefunds: vi.fn(), keep: vi.fn(),
}))
const idem = vi.hoisted(() => ({ tryMarkProcessed: vi.fn(), releaseIdempotencyKey: vi.fn() }))

vi.mock('@/infrastructure/supabase/repositories/booking-deposit-repository', () => ({ bookingDepositStore: store, depositBookingWriter: {} }))
vi.mock('@/infrastructure/supabase/repositories/merchant-payment-account-repository', () => ({ merchantPaymentAccountReader: {} }))
vi.mock('@/infrastructure/supabase/idempotency', () => idem)

import { POST } from '../route'

const KEY = 'sk_test_51FAKEkeyForRouteTests000000'
const WHSEC = 'whsec_route_test_secret_00000000000'
const URL_ = 'http://localhost/api/webhooks/payments/stripe'

const event = (id: string) =>
  JSON.stringify({
    id, object: 'event', api_version: Stripe.API_VERSION, created: 1, livemode: false, type: 'checkout.session.completed', account: 'acct_1R',
    data: { object: { id: 'cs_1', object: 'checkout.session', amount_total: 40000, currency: 'hkd', payment_status: 'paid', payment_intent: 'pi_1' } },
  })

const post = (body: string, headers: Record<string, string> = {}) => new NextRequest(URL_, { method: 'POST', body, headers })
const signedPost = (body: string, secret = WHSEC) =>
  post(body, { 'stripe-signature': Stripe.webhooks.generateTestHeaderString({ payload: body, secret }), 'content-type': 'application/json' })

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.stubEnv('STRIPE_SECRET_KEY', KEY)
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', WHSEC)
  vi.stubEnv('STRIPE_MODE', 'test')
  idem.tryMarkProcessed.mockResolvedValue('new')
  store.findBySession.mockResolvedValue(null)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('R47: fails closed', () => {
  it.each(['', '   '])('STRIPE_WEBHOOK_SECRET unset (%j) -> 500 and the deposit store is never called', async (value) => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', value)
    const res = await POST(signedPost(event('evt_1')))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'not_configured' })
    for (const fn of Object.values(store)) expect(fn).not.toHaveBeenCalled()
    expect(idem.tryMarkProcessed).not.toHaveBeenCalled()
  })

  it('no signature header -> 400, nothing claimed or read', async () => {
    const res = await POST(post(event('evt_2')))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_signature' })
    expect(idem.tryMarkProcessed).not.toHaveBeenCalled()
    expect(store.findBySession).not.toHaveBeenCalled()
  })

  it('bad signature (another secret) -> 400, nothing claimed or read', async () => {
    const res = await POST(signedPost(event('evt_3'), 'whsec_someone_else'))
    expect(res.status).toBe(400)
    expect(idem.tryMarkProcessed).not.toHaveBeenCalled()
    expect(store.findBySession).not.toHaveBeenCalled()
  })

  it('valid signature -> 200, claimed as stripe:<event id> after verification, then matched by our session id', async () => {
    const res = await POST(signedPost(event('evt_4')))
    expect(res.status).toBe(200)
    // An unknown session is not ours (another platform's Checkout on the same account): ignored (review finding 7).
    expect(await res.json()).toEqual({ received: true, outcomes: ['ignored'] })
    expect(idem.tryMarkProcessed).toHaveBeenCalledWith('stripe:evt_4', expect.any(Function))
    expect(store.findBySession).toHaveBeenCalledWith('stripe', 'cs_1')
    expect(store.markPaid).not.toHaveBeenCalled()
  })
})

describe('R48: oversize bodies are refused before any verification', () => {
  it('a declared Content-Length over 256 KB -> 413', async () => {
    const res = await POST(post('{}', { 'content-length': String(256 * 1024 + 1), 'stripe-signature': 't=1,v1=x' }))
    expect(res.status).toBe(413)
    expect(idem.tryMarkProcessed).not.toHaveBeenCalled()
  })
  it('a chunked body with no Content-Length over 256 KB -> 413, and reading stops at the cap (never fully buffered)', async () => {
    const chunk = new Uint8Array(16 * 1024).fill(0x61)
    const total = 300 * 1024
    let pulled = 0
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled >= total) return controller.close()
        pulled += chunk.length
        controller.enqueue(chunk)
      },
      cancel() {
        cancelled = true
      },
    }, { highWaterMark: 0 })
    const req = new NextRequest(URL_, { method: 'POST', body, headers: { 'stripe-signature': 't=1,v1=x' }, duplex: 'half' })
    expect(req.headers.get('content-length')).toBeNull()
    const res = await POST(req)
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'payload_too_large' })
    expect(pulled).toBeLessThan(total)
    expect(pulled).toBeLessThanOrEqual(256 * 1024 + chunk.length)
    expect(cancelled).toBe(true)
    expect(idem.tryMarkProcessed).not.toHaveBeenCalled()
  })
  it('an actual body over 256 KB -> 413 (no verify, nothing claimed)', async () => {
    const big = JSON.stringify({ pad: 'x'.repeat(256 * 1024) })
    const res = await POST(signedPost(big))
    expect(res.status).toBe(413)
    expect(idem.tryMarkProcessed).not.toHaveBeenCalled()
    expect(store.findBySession).not.toHaveBeenCalled()
  })
})

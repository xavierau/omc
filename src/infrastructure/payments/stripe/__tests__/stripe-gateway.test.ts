// BOOK-014 W1 AC-4: the Stripe adapter with the real SDK and a stubbed HTTP
// client: no network, no real key. Asserts what Stripe would receive (direct
// charge on the connected account, R61 metadata), the webhook mapping (R51),
// the key/mode checks (R50, R63) and that provider error text never leaves
// the adapter (R64).
import { describe, it, expect } from 'vitest'
import Stripe from 'stripe'
import { createStripeGateway, sessionExpiry, stripeGatewayFromEnv } from '../stripe-gateway'
import { StripeConfigError, parseStripeSettings } from '../stripe-config'
import { PaymentGatewayError, WebhookSignatureError } from '@/domain/ports/payment-gateway'
import { money } from '@/domain/value-objects/money'
import { STAFF_HOLD_MS } from '@/domain/entities/booking-deposit'
import { processPaymentWebhook } from '@/application/payments/process-payment-webhook'
import { FakeDepositLedger, FakeWebhookClaims, memoryLog } from '@/test-utils/fake-booking-deposit'
import { createPaymentGatewayRegistry } from '@/infrastructure/payments/registry'

const KEY = 'sk_test_51FAKEkeyForUnitTestsOnly000000'
const WHSEC = 'whsec_unit_test_secret_000000000000'
const NOW = new Date('2026-12-01T10:00:00Z')

interface Sent {
  method: string
  path: string
  headers: Headers
  body: URLSearchParams
}

type Reply = { status: number; json: unknown }

function stubbedStripe(reply: (req: Sent) => Reply | Promise<Reply>) {
  const sent: Sent[] = []
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const req: Sent = {
      method: init?.method ?? 'GET',
      path: url.pathname,
      headers: new Headers(init?.headers as HeadersInit),
      body: new URLSearchParams(typeof init?.body === 'string' ? init.body : ''),
    }
    sent.push(req)
    const r = await reply(req)
    return new Response(JSON.stringify(r.json), { status: r.status, headers: { 'content-type': 'application/json', 'request-id': 'req_test' } })
  }) as typeof fetch
  const gateway = createStripeGateway({ secretKey: KEY, webhookSecret: WHSEC, mode: 'test', httpClient: Stripe.createFetchHttpClient(fetchFn), now: () => NOW })
  return { gateway, sent }
}

const session = { id: 'cs_test_1', object: 'checkout.session', url: 'https://checkout.stripe.com/c/pay/cs_test_1', expires_at: 1_764_585_000 }
const stripeError = (status: number, type: string, message: string, code?: string): Reply => ({ status, json: { error: { type, message, ...(code ? { code } : {}) } } })

const hosted = {
  accountRef: 'acct_1RESTAURANT',
  amount: money(40000, 'HKD'),
  description: 'Deposit · Café A · 2026-12-24 19:00 · 4 guests',
  successUrl: 'https://app.example/p/tok?return=success',
  cancelUrl: 'https://app.example/p/tok?return=cancel',
  expiresAt: new Date(NOW.getTime() + 30 * 60_000),
  idempotencyKey: 'dep-uuid-1',
  metadata: { deposit_id: 'dep-uuid-1', booking_id: 'book-uuid-1' },
}

describe('createHostedPayment: Checkout Session on the connected account (direct charge)', () => {
  it('carries Stripe-Account, amount, currency, expires_at, the idempotency key and metadata ONLY {deposit_id, booking_id} (R61)', async () => {
    const { gateway, sent } = stubbedStripe(() => ({ status: 200, json: session }))
    const out = await gateway.createHostedPayment(hosted)
    expect(out).toEqual({ sessionRef: 'cs_test_1', url: session.url, expiresAt: new Date(session.expires_at * 1000) })
    const [req] = sent
    expect(req.method).toBe('POST')
    expect(req.path).toBe('/v1/checkout/sessions')
    expect(req.headers.get('stripe-account')).toBe('acct_1RESTAURANT')
    expect(req.headers.get('idempotency-key')).toBe('dep-uuid-1')
    expect(req.headers.get('authorization')).toBe(`Bearer ${KEY}`)
    const body = Object.fromEntries(req.body)
    expect(body).toMatchObject({
      mode: 'payment',
      'allowed_payment_method_types[0]': 'card',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'hkd',
      'line_items[0][price_data][unit_amount]': '40000',
      'line_items[0][price_data][product_data][name]': hosted.description,
      success_url: hosted.successUrl,
      cancel_url: hosted.cancelUrl,
      expires_at: String(Math.floor(NOW.getTime() / 1000) + 31 * 60),
    })
    expect(Object.keys(body).filter((k) => k.startsWith('metadata')).sort()).toEqual(['metadata[booking_id]', 'metadata[deposit_id]'])
    expect(body['metadata[deposit_id]']).toBe('dep-uuid-1')
    expect(body['metadata[booking_id]']).toBe('book-uuid-1')
    for (const k of Object.keys(body)) expect(k).not.toMatch(/customer|email|phone|application_fee|payment_intent_data|client_reference_id/)
  })

  it('expires_at stays inside Stripe’s 30 min .. 24 h window', () => {
    const s = (ms: number) => sessionExpiry(new Date(NOW.getTime() + ms), NOW) - NOW.getTime() / 1000
    expect(s(30 * 60_000)).toBe(31 * 60)
    expect(s(24 * 3_600_000)).toBe(24 * 3600 - 60)
    expect(s(2 * 3_600_000)).toBe(2 * 3600)
  })

  it('review finding 5: a staff hold never outlives its Checkout Session (hold <= Stripe maximum, rounded up to the second)', () => {
    expect(STAFF_HOLD_MS).toBeLessThanOrEqual(24 * 3_600_000 - 2 * 60_000)
    const t0 = Date.parse('2026-12-01T10:00:00.789Z')
    const hold = new Date(t0 + STAFF_HOLD_MS)
    for (const lag of [0, 250, 5_000, 59_000]) {
      expect(sessionExpiry(hold, new Date(t0 + lag)) * 1000, `lag ${lag}`).toBeGreaterThanOrEqual(hold.getTime())
    }
  })

  it('R64: a Stripe error becomes a coded PaymentGatewayError without Stripe’s text (it can name accounts)', async () => {
    const { gateway } = stubbedStripe(() => stripeError(400, 'invalid_request_error', 'No such account: acct_1LEAKED', 'account_invalid'))
    const err = await gateway.createHostedPayment(hosted).catch((e) => e)
    expect(err).toBeInstanceOf(PaymentGatewayError)
    expect(err.code).toBe('rejected')
    expect(err.message).toBe('stripe checkout.sessions.create StripeInvalidRequestError account_invalid')
    expect(err.message).not.toContain('acct_1LEAKED')
  })

  it('404 resource_missing -> not_found; a connection failure -> unavailable', async () => {
    const missing = stubbedStripe(() => stripeError(404, 'invalid_request_error', 'No such refund', 'resource_missing'))
    expect((await missing.gateway.getAccountStatus('acct_x').catch((e) => e)).code).toBe('not_found')
    const down = stubbedStripe(() => {
      throw new TypeError('fetch failed')
    })
    expect((await down.gateway.getAccountStatus('acct_x').catch((e) => e)).code).toBe('unavailable')
  })
})

describe('expire, refund, accounts', () => {
  it('expire: open -> expired:true; already completed (400) -> expired:false, not an error (R57)', async () => {
    const ok = stubbedStripe(() => ({ status: 200, json: { ...session, status: 'expired' } }))
    expect(await ok.gateway.expireHostedPayment({ accountRef: 'acct_1R', sessionRef: 'cs_test_1' })).toEqual({ expired: true })
    expect(ok.sent[0].path).toBe('/v1/checkout/sessions/cs_test_1/expire')
    expect(ok.sent[0].headers.get('stripe-account')).toBe('acct_1R')
    const done = stubbedStripe(() => stripeError(400, 'invalid_request_error', 'Only Checkout Sessions with a status in ["open"] can be expired.'))
    expect(await done.gateway.expireHostedPayment({ accountRef: 'acct_1R', sessionRef: 'cs_test_1' })).toEqual({ expired: false })
  })

  it('refund: full amount on the payment intent, on the connected account, with the given key', async () => {
    const { gateway, sent } = stubbedStripe(() => ({ status: 200, json: { id: 're_1', object: 'refund', status: 'pending' } }))
    expect(await gateway.refund({ accountRef: 'acct_1R', paymentRef: 'pi_1', amount: money(40000, 'HKD'), idempotencyKey: 'refund:d1:1' })).toEqual({
      refundRef: 're_1', status: 'pending',
    })
    expect(sent[0].path).toBe('/v1/refunds')
    expect(Object.fromEntries(sent[0].body)).toEqual({ payment_intent: 'pi_1', amount: '40000' })
    expect(sent[0].headers.get('stripe-account')).toBe('acct_1R')
    expect(sent[0].headers.get('idempotency-key')).toBe('refund:d1:1')
  })

  it('review finding 1c: charge_already_refunded -> already_refunded (money is back), not an error; other refusals stay errors', async () => {
    const done = stubbedStripe(() => stripeError(400, 'invalid_request_error', 'Charge ch_1 has already been refunded.', 'charge_already_refunded'))
    expect(await done.gateway.refund({ accountRef: 'acct_1R', paymentRef: 'pi_1', amount: money(40000, 'HKD'), idempotencyKey: 'refund:d1:2' })).toEqual({
      refundRef: null, status: 'already_refunded',
    })
    const tooMuch = stubbedStripe(() => stripeError(400, 'invalid_request_error', 'Refund amount is greater than unrefunded amount.', 'amount_too_large'))
    const err = await tooMuch.gateway.refund({ accountRef: 'acct_1R', paymentRef: 'pi_1', amount: money(40000, 'HKD'), idempotencyKey: 'refund:d1:3' }).catch((e) => e)
    expect(err).toBeInstanceOf(PaymentGatewayError)
    expect(err.code).toBe('rejected')
  })

  it('Standard account created server side; onboarding link and status read from Stripe', async () => {
    const { gateway, sent } = stubbedStripe((req) => {
      if (req.path === '/v1/accounts') return { status: 200, json: { id: 'acct_1NEW', object: 'account' } }
      if (req.path === '/v1/account_links') return { status: 200, json: { object: 'account_link', url: 'https://connect.stripe.com/setup/s/x' } }
      return {
        status: 200,
        json: { id: 'acct_1NEW', object: 'account', charges_enabled: true, details_submitted: true, default_currency: 'hkd', requirements: { disabled_reason: null } },
      }
    })
    expect(await gateway.createAccount({ restaurantId: 'rest-a' })).toEqual({ accountRef: 'acct_1NEW' })
    expect(Object.fromEntries(sent[0].body)).toEqual({ type: 'standard', 'metadata[restaurant_id]': 'rest-a' })
    expect(sent[0].headers.get('stripe-account')).toBeNull()
    expect(await gateway.createOnboardingLink({ accountRef: 'acct_1NEW', returnUrl: 'https://a/r', refreshUrl: 'https://a/f' })).toEqual({
      url: 'https://connect.stripe.com/setup/s/x',
    })
    expect(Object.fromEntries(sent[1].body)).toMatchObject({ account: 'acct_1NEW', type: 'account_onboarding' })
    expect(await gateway.getAccountStatus('acct_1NEW')).toEqual({ chargesEnabled: true, detailsSubmitted: true, currency: 'HKD', disabledReason: null })
  })
})

const signed = (event: Record<string, unknown>, secret = WHSEC) => {
  const payload = JSON.stringify({ object: 'event', api_version: Stripe.API_VERSION, created: 1, livemode: false, ...event })
  return { rawBody: payload, headers: new Headers({ 'stripe-signature': Stripe.webhooks.generateTestHeaderString({ payload, secret }) }) }
}

describe('parseWebhook: signature on the raw body, then normalised (R48, R51)', () => {
  const { gateway } = stubbedStripe(() => ({ status: 500, json: {} }))

  it('maps the six subscribed types', () => {
    const completed = signed({
      id: 'evt_1', type: 'checkout.session.completed', account: 'acct_1R',
      data: { object: { id: 'cs_1', object: 'checkout.session', amount_total: 40000, currency: 'hkd', payment_status: 'paid', payment_intent: 'pi_1', metadata: { booking_id: 'b' } } },
    })
    expect(gateway.parseWebhook(completed)).toEqual([
      { type: 'payment_succeeded', eventId: 'evt_1', livemode: false, accountRef: 'acct_1R', sessionRef: 'cs_1', paymentRef: 'pi_1', amount: { amountMinor: 40000, currency: 'HKD' }, paid: true },
    ])
    expect(gateway.parseWebhook(signed({ id: 'evt_2', type: 'checkout.session.expired', account: 'acct_1R', data: { object: { id: 'cs_1', object: 'checkout.session' } } }))).toEqual([
      { type: 'payment_expired', eventId: 'evt_2', livemode: false, accountRef: 'acct_1R', sessionRef: 'cs_1' },
    ])
    expect(gateway.parseWebhook(signed({ id: 'evt_3', type: 'charge.refunded', account: 'acct_1R', data: { object: { id: 'ch_1', object: 'charge', refunded: true, payment_intent: 'pi_1' } } }))).toEqual([
      { type: 'refund_succeeded', eventId: 'evt_3', livemode: false, accountRef: 'acct_1R', paymentRef: 'pi_1', refundRef: null },
    ])
    expect(gateway.parseWebhook(signed({ id: 'evt_3b', type: 'charge.refunded', account: 'acct_1R', data: { object: { id: 'ch_1', object: 'charge', refunded: false, payment_intent: 'pi_1' } } }))).toEqual([])
    expect(gateway.parseWebhook(signed({ id: 'evt_4', type: 'refund.updated', account: 'acct_1R', data: { object: { id: 're_1', object: 'refund', status: 'failed', payment_intent: 'pi_1' } } }))).toEqual([
      { type: 'refund_failed', eventId: 'evt_4', livemode: false, accountRef: 'acct_1R', paymentRef: 'pi_1', refundRef: 're_1' },
    ])
    expect(gateway.parseWebhook(signed({ id: 'evt_4b', type: 'refund.updated', account: 'acct_1R', data: { object: { id: 're_1', object: 'refund', status: 'succeeded', payment_intent: 'pi_1' } } }))).toEqual([
      { type: 'refund_succeeded', eventId: 'evt_4b', livemode: false, accountRef: 'acct_1R', paymentRef: 'pi_1', refundRef: 're_1' },
    ])
    expect(
      gateway.parseWebhook(signed({
        id: 'evt_5', type: 'account.updated', account: 'acct_1R',
        data: { object: { id: 'acct_1R', object: 'account', charges_enabled: false, details_submitted: true, default_currency: 'hkd', requirements: { disabled_reason: 'requirements.past_due' } } },
      }))
    ).toEqual([
      { type: 'account_updated', eventId: 'evt_5', livemode: false, accountRef: 'acct_1R', status: { chargesEnabled: false, detailsSubmitted: true, currency: 'HKD', disabledReason: 'requirements.past_due' } },
    ])
    expect(gateway.parseWebhook(signed({ id: 'evt_6', type: 'account.application.deauthorized', account: 'acct_1R', data: { object: { id: 'ca_1', object: 'application' } } }))).toEqual([
      { type: 'account_deauthorized', eventId: 'evt_6', livemode: false, accountRef: 'acct_1R' },
    ])
  })

  it('unknown types map to nothing (the route answers 200)', () => {
    expect(gateway.parseWebhook(signed({ id: 'evt_7', type: 'customer.created', data: { object: { id: 'cus_1', object: 'customer' } } }))).toEqual([])
  })

  it('missing, wrong-secret or tampered signatures throw WebhookSignatureError', () => {
    const good = signed({ id: 'evt_8', type: 'customer.created', data: { object: { id: 'cus_1', object: 'customer' } } })
    expect(() => gateway.parseWebhook({ rawBody: good.rawBody, headers: new Headers() })).toThrow(WebhookSignatureError)
    expect(() => gateway.parseWebhook(signed({ id: 'evt_9', type: 'customer.created', data: { object: {} } }, 'whsec_other'))).toThrow(WebhookSignatureError)
    expect(() => gateway.parseWebhook({ rawBody: good.rawBody.replace('evt_8', 'evt_X'), headers: good.headers })).toThrow(WebhookSignatureError)
  })
})

describe('R49 through the Stripe adapter: metadata is never a lookup key', () => {
  it("a correctly signed completed session carrying another tenant's booking id in metadata, with a session id we never stored -> no change", async () => {
    const { gateway } = stubbedStripe(() => ({ status: 500, json: {} }))
    const ledger = new FakeDepositLedger(() => NOW)
    const { log, lines } = memoryLog()
    const victim = await ledger.insertWithDeposit(
      { restaurantId: 'rest-victim', memberId: null, phone: '+85291234567', name: 'v', partySize: 2, bookingDate: '2026-12-24', bookingTime: '19:00', notes: null, source: 'chat', campaignId: null, token: null },
      { periodKey: null, periodFirst: null, periodLast: null, perSlot: null, perMeal: null },
      { id: 'dep-victim', providerCode: 'stripe', accountId: 'a', providerAccountId: 'acct_1VICTIM', amount: money(20000, 'HKD'), holdExpiresAt: new Date(NOW.getTime() + 1_800_000).toISOString(), linkTokenHash: 'f'.repeat(64) },
      null
    )
    if (!victim.ok) throw new Error('seed failed')
    await ledger.attachSession('dep-victim', { sessionRef: 'cs_ours', url: 'https://checkout.stripe.com/c/pay/cs_ours' })
    const attack = signed({
      id: 'evt_attack', type: 'checkout.session.completed', account: 'acct_1ATTACKER',
      data: { object: { id: 'cs_attackers_own', object: 'checkout.session', amount_total: 20000, currency: 'hkd', payment_status: 'paid', payment_intent: 'pi_a', metadata: { booking_id: victim.booking.id, deposit_id: 'dep-victim' } } },
    })
    const registry = createPaymentGatewayRegistry({ stripe: () => gateway })
    const out = await processPaymentWebhook(
      { gateway, claims: new FakeWebhookClaims(), deposits: ledger, registry, now: () => NOW, log },
      attack
    )
    // Review finding 7: a session we never stored is not ours: ignored with an info line, no change.
    expect(out.body).toEqual({ received: true, outcomes: ['ignored'] })
    expect(ledger.booking(victim.booking.id)?.status).toBe('awaiting_deposit')
    expect(ledger.deposits.get('dep-victim')?.status).toBe('awaiting')
    expect(lines).toContainEqual({ level: 'info', event: 'payment.unrelated_session', data: { eventId: 'evt_attack', sessionRef: 'cs_attackers_own' } })
  })
})

describe('R50 / R63: settings are checked at construction', () => {
  it('key prefix must match the mode, or construction throws', () => {
    expect(() => createStripeGateway({ secretKey: 'sk_live_abc', webhookSecret: WHSEC, mode: 'test' })).toThrow(StripeConfigError)
    expect(() => createStripeGateway({ secretKey: 'rk_test_abc', webhookSecret: WHSEC, mode: 'live' })).toThrow(StripeConfigError)
    expect(createStripeGateway({ secretKey: 'rk_test_abc', webhookSecret: WHSEC, mode: 'test' }).livemode).toBe(false)
    expect(createStripeGateway({ secretKey: 'rk_live_abc', webhookSecret: WHSEC, mode: 'live' }).livemode).toBe(true)
  })
  it('missing key, secret or mode, or a malformed one, throws without echoing the value', () => {
    expect(() => stripeGatewayFromEnv({ STRIPE_WEBHOOK_SECRET: WHSEC, STRIPE_MODE: 'test' })).toThrow('STRIPE_SECRET_KEY is not set')
    expect(() => stripeGatewayFromEnv({ STRIPE_SECRET_KEY: KEY, STRIPE_MODE: 'test' })).toThrow('STRIPE_WEBHOOK_SECRET is not set')
    expect(() => stripeGatewayFromEnv({ STRIPE_SECRET_KEY: KEY, STRIPE_WEBHOOK_SECRET: WHSEC })).toThrow('STRIPE_MODE')
    expect(() => parseStripeSettings({ STRIPE_SECRET_KEY: 'pk_test_abc', STRIPE_WEBHOOK_SECRET: WHSEC, STRIPE_MODE: 'test' })).toThrow(StripeConfigError)
    const err = (() => {
      try {
        parseStripeSettings({ STRIPE_SECRET_KEY: 'sk_live_SECRETVALUE', STRIPE_WEBHOOK_SECRET: WHSEC, STRIPE_MODE: 'test' })
      } catch (e) {
        return e as Error
      }
    })()
    expect(err?.message).not.toContain('SECRETVALUE')
  })
  it('hosted pages may only be checkout.stripe.com (R62)', () => {
    expect(stripeGatewayFromEnv({ STRIPE_SECRET_KEY: KEY, STRIPE_WEBHOOK_SECRET: WHSEC, STRIPE_MODE: 'test' }).allowedRedirectHosts).toEqual(['checkout.stripe.com'])
  })
})

// BOOK-014 W1: the payment logger redacts secrets (R63), the test adapter is
// a real signed adapter (AC-16), and the registry fails closed (R51).
import { describe, it, expect, vi } from 'vitest'
import { REDACTED, createPaymentLogger, redactSecrets } from '../payment-logger'
import { TestPaymentGateway } from '../test/test-gateway'
import { PaymentProviderNotConfiguredError, createPaymentGatewayRegistry } from '../registry'
import { WebhookSignatureError } from '@/domain/ports/payment-gateway'
import { money } from '@/domain/value-objects/money'

describe('R63: the payment logger redacts key-shaped strings', () => {
  it('sk_/rk_ keys and whsec_ secrets, at any depth', () => {
    const data = {
      error: 'Invalid API Key provided: sk_live_51ABCdefGHI and rk_test_9xyz',
      nested: { secret: 'whsec_abc123+/=', list: ['ok', 'sk_test_ZZZ'] },
      depositId: 'dep-1',
    }
    expect(redactSecrets(data)).toEqual({
      error: `Invalid API Key provided: ${REDACTED} and ${REDACTED}`,
      nested: { secret: REDACTED, list: ['ok', REDACTED] },
      depositId: 'dep-1',
    })
  })
  it('the sink never sees the secret', () => {
    const sink = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    createPaymentLogger(sink)('error', 'deposit.start_failed', { error: 'bad key sk_test_SECRET123' })
    const line = sink.error.mock.calls[0][0] as string
    expect(line).toContain('deposit.start_failed')
    expect(line).not.toContain('sk_test_SECRET123')
  })
})

describe('AC-16: the test adapter signs and verifies its own webhooks', () => {
  const now = new Date('2026-12-01T10:00:00Z')
  const gateway = () => {
    const g = new TestPaymentGateway({ secret: 'secret-1', now: () => now })
    g.addAccount('acct_test_A')
    return g
  }

  it('a signed delivery parses; another secret, a stale timestamp or a changed body throws', async () => {
    const g = gateway()
    const s = await g.createHostedPayment({
      accountRef: 'acct_test_A', amount: money(1000, 'HKD'), description: 'd', successUrl: 'https://a/s', cancelUrl: 'https://a/c',
      expiresAt: new Date(now.getTime() + 1_800_000), idempotencyKey: 'k1', metadata: { deposit_id: 'd1', booking_id: 'b1' },
    })
    const delivery = g.completeSession(s.sessionRef)
    expect(g.parseWebhook(delivery)).toEqual([expect.objectContaining({ type: 'payment_succeeded', sessionRef: s.sessionRef, paid: true })])
    const other = new TestPaymentGateway({ secret: 'secret-2', now: () => now })
    expect(() => other.parseWebhook(delivery)).toThrow(WebhookSignatureError)
    const later = new TestPaymentGateway({ secret: 'secret-1', now: () => new Date(now.getTime() + 301_000) })
    expect(() => later.parseWebhook(delivery)).toThrow(WebhookSignatureError)
    expect(() => g.parseWebhook({ rawBody: delivery.rawBody.replace('1000', '1'), headers: delivery.headers })).toThrow(WebhookSignatureError)
  })

  it('idempotency keys: the same key returns the same session and the same refund', async () => {
    const g = gateway()
    const req = {
      accountRef: 'acct_test_A', amount: money(1000, 'HKD'), description: 'd', successUrl: 'https://a/s', cancelUrl: 'https://a/c',
      expiresAt: new Date(now.getTime() + 1_800_000), idempotencyKey: 'k1', metadata: { deposit_id: 'd1', booking_id: 'b1' },
    }
    const a = await g.createHostedPayment(req)
    expect(await g.createHostedPayment(req)).toEqual(a)
    g.completeSession(a.sessionRef)
    const paymentRef = g.sessions.get(a.sessionRef)!.paymentRef!
    const r1 = await g.refund({ accountRef: 'acct_test_A', paymentRef, amount: money(1000, 'HKD'), idempotencyKey: 'refund:d1:1' })
    expect(await g.refund({ accountRef: 'acct_test_A', paymentRef, amount: money(1000, 'HKD'), idempotencyKey: 'refund:d1:1' })).toEqual(r1)
    // A new key on a fully refunded payment: "already refunded", no second refund (review finding 1c).
    expect(await g.refund({ accountRef: 'acct_test_A', paymentRef, amount: money(1000, 'HKD'), idempotencyKey: 'refund:d1:2' })).toEqual({
      refundRef: null, status: 'already_refunded',
    })
    expect(g.refunds.size).toBe(1)
  })
})

describe('R51: the registry', () => {
  it('builds an adapter once per code; an unconfigured code throws (callers fail closed)', () => {
    const factory = vi.fn(() => new TestPaymentGateway({ secret: 's' }))
    const registry = createPaymentGatewayRegistry({ test: factory })
    expect(registry.get('test')).toBe(registry.get('test'))
    expect(factory).toHaveBeenCalledTimes(1)
    expect(() => registry.get('stripe')).toThrow(PaymentProviderNotConfiguredError)
  })
  it('a factory that throws (missing env) throws on get, every time', () => {
    const registry = createPaymentGatewayRegistry({
      stripe: () => {
        throw new Error('STRIPE_SECRET_KEY is not set')
      },
    })
    expect(() => registry.get('stripe')).toThrow('STRIPE_SECRET_KEY is not set')
    expect(() => registry.get('stripe')).toThrow('STRIPE_SECRET_KEY is not set')
  })
})

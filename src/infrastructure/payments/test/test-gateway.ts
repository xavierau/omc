/**
 * BOOK-014 (spec AC-16): the in-repo test provider. A REAL PaymentGatewayPort
 * adapter, in memory and deterministic: it keeps accounts, hosted sessions
 * and refunds, honours idempotency keys, and signs its own webhooks
 * (HMAC-SHA256 over "<timestamp>.<raw body>", header `x-test-signature:
 * t=<unix>,v1=<hex>`, 300 s tolerance), so the whole deposit flow runs in
 * vitest through the same port Stripe uses. It proves a new region needs only
 * an adapter like this one plus its webhook route and onboarding screen.
 *
 * Never registered in production (infrastructure/payments/registry.ts).
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  PaymentGatewayError,
  WebhookSignatureError,
  type HostedPayment,
  type HostedPaymentRequest,
  type NormalizedPaymentEvent,
  type PaymentGatewayErrorCode,
  type PaymentGatewayPort,
  type ProviderAccountStatus,
  type RefundRequest,
  type RefundResult,
  type WebhookRequest,
} from '@/domain/ports/payment-gateway'
import { money, type Money } from '@/domain/value-objects/money'

export const TEST_PAY_HOST = 'pay.test.invalid'
const TOLERANCE_S = 300

interface TestSession {
  id: string
  accountRef: string
  amount: Money
  url: string
  status: 'open' | 'complete' | 'expired'
  expiresAt: Date
  metadata: HostedPaymentRequest['metadata']
  description: string
  successUrl: string
  cancelUrl: string
  paymentRef: string | null
}

interface TestRefund {
  id: string
  accountRef: string
  paymentRef: string
  amount: Money
  status: TestRefundStatus
}

type TestRefundStatus = 'succeeded' | 'pending' | 'failed'

/** The test provider's own wire format (deliberately not Stripe's). */
type WireEvent =
  | { id: string; type: 'session.completed'; livemode: boolean; account: string; session: string; payment: string | null; amount: number; currency: string; paid: boolean }
  | { id: string; type: 'session.expired'; livemode: boolean; account: string; session: string }
  /** `refund: null` = the provider says the payment is fully refunded, naming no refund (as Stripe's charge.refunded). */
  | { id: string; type: 'refund.settled'; livemode: boolean; account: string; payment: string; refund: string | null; ok: boolean }
  | { id: string; type: 'account.updated'; livemode: boolean; account: string; charges: boolean; currency: string | null }
  | { id: string; type: 'account.deauthorized'; livemode: boolean; account: string }
  | { id: string; type: string; livemode: boolean; account: string }

export interface SignedDelivery {
  rawBody: string
  headers: Headers
}

export interface TestGatewayOptions {
  secret: string
  livemode?: boolean
  now?: () => Date
}

type FailableOp = 'createHostedPayment' | 'refund' | 'expireHostedPayment' | 'createAccount'

export class TestPaymentGateway implements PaymentGatewayPort {
  readonly code = 'test' as const
  readonly livemode: boolean
  readonly allowedRedirectHosts = [TEST_PAY_HOST] as const

  readonly accounts = new Map<string, ProviderAccountStatus>()
  readonly sessions = new Map<string, TestSession>()
  readonly refunds = new Map<string, TestRefund>()
  readonly calls: Record<FailableOp | 'getAccountStatus', number> = {
    createHostedPayment: 0, refund: 0, expireHostedPayment: 0, createAccount: 0, getAccountStatus: 0,
  }
  /** The next refund settles as this (a real provider can answer pending, then settle by webhook). */
  refundOutcome: TestRefundStatus = 'succeeded'

  private readonly secret: string
  private readonly now: () => Date
  private readonly byKey = new Map<string, string>()
  private readonly failures = new Map<FailableOp, PaymentGatewayErrorCode>()
  private seq = 0

  constructor(options: TestGatewayOptions) {
    if (!options.secret) throw new Error('TestPaymentGateway: secret is required')
    this.secret = options.secret
    this.livemode = options.livemode ?? false
    this.now = options.now ?? (() => new Date())
  }

  private nextId(prefix: string) {
    this.seq += 1
    return `${prefix}_${String(this.seq).padStart(6, '0')}`
  }

  /** The next call of `op` throws PaymentGatewayError(code). */
  failNext(op: FailableOp, code: PaymentGatewayErrorCode = 'unavailable') {
    this.failures.set(op, code)
  }

  private maybeFail(op: FailableOp) {
    this.calls[op] += 1
    const code = this.failures.get(op)
    if (code) {
      this.failures.delete(op)
      throw new PaymentGatewayError(code, `test ${op} ${code}`)
    }
  }

  addAccount(accountRef: string, status: Partial<ProviderAccountStatus> = {}) {
    this.accounts.set(accountRef, { chargesEnabled: true, detailsSubmitted: true, currency: 'HKD', disabledReason: null, ...status })
  }

  async createAccount(): Promise<{ accountRef: string }> {
    this.maybeFail('createAccount')
    const accountRef = this.nextId('acct_test')
    this.accounts.set(accountRef, { chargesEnabled: false, detailsSubmitted: false, currency: null, disabledReason: null })
    return { accountRef }
  }

  async createOnboardingLink({ accountRef }: { accountRef: string }): Promise<{ url: string }> {
    if (!this.accounts.has(accountRef)) throw new PaymentGatewayError('not_found', 'test account not found')
    return { url: `https://${TEST_PAY_HOST}/onboard/${accountRef}` }
  }

  async getAccountStatus(accountRef: string): Promise<ProviderAccountStatus> {
    this.calls.getAccountStatus += 1
    const status = this.accounts.get(accountRef)
    if (!status) throw new PaymentGatewayError('not_found', 'test account not found')
    return { ...status }
  }

  async createHostedPayment(request: HostedPaymentRequest): Promise<HostedPayment> {
    this.maybeFail('createHostedPayment')
    const known = this.byKey.get(`session:${request.accountRef}:${request.idempotencyKey}`)
    if (known) {
      const s = this.sessions.get(known)!
      return { sessionRef: s.id, url: s.url, expiresAt: s.expiresAt }
    }
    if (!this.accounts.get(request.accountRef)?.chargesEnabled) throw new PaymentGatewayError('rejected', 'test account cannot charge')
    const id = this.nextId('sess')
    const session: TestSession = {
      id, accountRef: request.accountRef, amount: request.amount, url: `https://${TEST_PAY_HOST}/s/${id}`, status: 'open',
      expiresAt: request.expiresAt, metadata: { ...request.metadata }, description: request.description,
      successUrl: request.successUrl, cancelUrl: request.cancelUrl, paymentRef: null,
    }
    this.sessions.set(id, session)
    this.byKey.set(`session:${request.accountRef}:${request.idempotencyKey}`, id)
    return { sessionRef: id, url: session.url, expiresAt: session.expiresAt }
  }

  async expireHostedPayment({ accountRef, sessionRef }: { accountRef: string; sessionRef: string }): Promise<{ expired: boolean }> {
    this.maybeFail('expireHostedPayment')
    const session = this.sessions.get(sessionRef)
    if (!session || session.accountRef !== accountRef) throw new PaymentGatewayError('not_found', 'test session not found')
    if (session.status !== 'open') return { expired: false }
    session.status = 'expired'
    return { expired: true }
  }

  async refund(request: RefundRequest): Promise<RefundResult> {
    this.maybeFail('refund')
    const key = `refund:${request.accountRef}:${request.idempotencyKey}`
    const known = this.byKey.get(key)
    if (known) {
      const r = this.refunds.get(known)!
      return { refundRef: r.id, status: r.status }
    }
    const session = [...this.sessions.values()].find((s) => s.paymentRef === request.paymentRef && s.accountRef === request.accountRef)
    if (!session) throw new PaymentGatewayError('not_found', 'test payment not found')
    const refunded = [...this.refunds.values()]
      .filter((r) => r.paymentRef === request.paymentRef && r.status !== 'failed')
      .reduce((sum, r) => sum + r.amount.amountMinor, 0)
    if (refunded >= session.amount.amountMinor) return { refundRef: null, status: 'already_refunded' }
    if (refunded + request.amount.amountMinor > session.amount.amountMinor) throw new PaymentGatewayError('rejected', 'test refund over the paid amount')
    const id = this.nextId('rf')
    this.refunds.set(id, { id, accountRef: request.accountRef, paymentRef: request.paymentRef, amount: request.amount, status: this.refundOutcome })
    this.byKey.set(key, id)
    return { refundRef: id, status: this.refundOutcome }
  }

  // ---- webhooks -----------------------------------------------------------

  sign(rawBody: string, at: Date = this.now()): string {
    const t = Math.floor(at.getTime() / 1000)
    const v1 = createHmac('sha256', this.secret).update(`${t}.${rawBody}`).digest('hex')
    return `t=${t},v1=${v1}`
  }

  private deliver(event: WireEvent): SignedDelivery {
    const rawBody = JSON.stringify(event)
    return { rawBody, headers: new Headers({ 'x-test-signature': this.sign(rawBody), 'content-type': 'application/json' }) }
  }

  private verify(rawBody: string, header: string | null) {
    const parts = Object.fromEntries((header ?? '').split(',').map((p) => p.split('=', 2) as [string, string]))
    const t = Number(parts.t)
    if (!header || !Number.isSafeInteger(t) || !/^[0-9a-f]{64}$/.test(parts.v1 ?? '')) throw new WebhookSignatureError('missing or malformed x-test-signature')
    if (Math.abs(this.now().getTime() / 1000 - t) > TOLERANCE_S) throw new WebhookSignatureError('stale signature')
    const expected = createHmac('sha256', this.secret).update(`${t}.${rawBody}`).digest()
    const given = Buffer.from(parts.v1, 'hex')
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new WebhookSignatureError()
  }

  parseWebhook({ rawBody, headers }: WebhookRequest): NormalizedPaymentEvent[] {
    this.verify(rawBody, headers.get('x-test-signature'))
    const e = JSON.parse(rawBody) as WireEvent
    const base = { eventId: e.id, livemode: e.livemode, accountRef: e.account }
    switch (e.type) {
      case 'session.completed': {
        const w = e as Extract<WireEvent, { type: 'session.completed' }>
        return [{ ...base, type: 'payment_succeeded', sessionRef: w.session, paymentRef: w.payment, amount: money(w.amount, w.currency), paid: w.paid }]
      }
      case 'session.expired':
        return [{ ...base, type: 'payment_expired', sessionRef: (e as Extract<WireEvent, { type: 'session.expired' }>).session }]
      case 'refund.settled': {
        const w = e as Extract<WireEvent, { type: 'refund.settled' }>
        return [{ ...base, type: w.ok ? 'refund_succeeded' : 'refund_failed', paymentRef: w.payment, refundRef: w.refund }]
      }
      case 'account.updated': {
        const w = e as Extract<WireEvent, { type: 'account.updated' }>
        return [{ ...base, type: 'account_updated', status: { chargesEnabled: w.charges, detailsSubmitted: w.charges, currency: w.currency, disabledReason: null } }]
      }
      case 'account.deauthorized':
        return [{ ...base, type: 'account_deauthorized' }]
      default:
        return []
    }
  }

  // ---- what the diner and the provider do (simulators) --------------------

  /** The diner pays the session: returns the signed completed event. Overrides forge a mismatching event. */
  completeSession(
    sessionRef: string,
    override: Partial<{ amount: number; currency: string; account: string; paid: boolean; livemode: boolean; eventId: string }> = {}
  ): SignedDelivery {
    const session = this.sessions.get(sessionRef)
    if (!session) throw new Error(`test session ${sessionRef} not found`)
    if (session.status === 'expired') throw new Error(`test session ${sessionRef} is expired and cannot be paid`)
    if (session.status === 'open') {
      session.status = 'complete'
      session.paymentRef = this.nextId('pay')
    }
    return this.deliver({
      id: override.eventId ?? this.nextId('evt'),
      type: 'session.completed',
      livemode: override.livemode ?? this.livemode,
      account: override.account ?? session.accountRef,
      session: session.id,
      payment: session.paymentRef,
      amount: override.amount ?? session.amount.amountMinor,
      currency: override.currency ?? session.amount.currency,
      paid: override.paid ?? true,
    })
  }

  /** The provider times a session out: returns the signed expired event. */
  expireSession(sessionRef: string): SignedDelivery {
    const session = this.sessions.get(sessionRef)
    if (!session) throw new Error(`test session ${sessionRef} not found`)
    if (session.status === 'open') session.status = 'expired'
    return this.deliver({ id: this.nextId('evt'), type: 'session.expired', livemode: this.livemode, account: session.accountRef, session: session.id })
  }

  /** A refund settles at the provider: returns the signed event. */
  settleRefund(refundRef: string, ok: boolean): SignedDelivery {
    const refund = this.refunds.get(refundRef)
    if (!refund) throw new Error(`test refund ${refundRef} not found`)
    refund.status = ok ? 'succeeded' : 'failed'
    return this.deliver({ id: this.nextId('evt'), type: 'refund.settled', livemode: this.livemode, account: refund.accountRef, payment: refund.paymentRef, refund: refund.id, ok })
  }

  /** Any event, signed (e.g. an unknown type). */
  signedEvent(event: WireEvent): SignedDelivery {
    return this.deliver(event)
  }
}

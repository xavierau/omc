// BOOK-014: one wired deposit world for tests: the test provider adapter, the
// in-memory ledger, an account, the webhook claims, a log and a clock. Every
// use case runs through the same ports production uses (spec AC-16).
import { randomUUID } from 'crypto'
import type { NewBookingRequest } from '@/domain/entities/booking-request'
import type { DepositHolder } from '@/domain/entities/booking-deposit'
import type { MerchantPaymentAccount } from '@/domain/entities/merchant-payment-account'
import type { DepositRule } from '@/domain/value-objects/deposit-rule'
import { mintPaymentLinkToken } from '@/domain/services/payment-link-token'
import { TestPaymentGateway, type SignedDelivery } from '@/infrastructure/payments/test/test-gateway'
import { createPaymentGatewayRegistry } from '@/infrastructure/payments/registry'
import { startDeposit, type StartDepositDeps } from '@/application/payments/start-deposit'
import { processPaymentWebhook, type ProcessPaymentWebhookDeps } from '@/application/payments/process-payment-webhook'
import type { DepositPaid } from '@/application/payments/handle-payment-event'
import type { ExpireDepositsDeps } from '@/application/payments/expire-deposits'
import type { DepositDecisionDeps } from '@/application/payments/deposit-decisions'
import type { ResolvePaymentLinkDeps } from '@/application/payments/resolve-payment-link'
import { FakeAccounts, FakeDepositLedger, FakeWebhookClaims, memoryLog } from './fake-booking-deposit'

export const RESTAURANT = 'rest-a'
export const OTHER_RESTAURANT = 'rest-b'
export const ACCOUNT_REF = 'acct_test_A'
export const WEBHOOK_SECRET = 'test-provider-secret'
export const APP_URL = 'https://app.example.test'
export const PER_GUEST_100: DepositRule = { enabled: true, mode: 'per_guest', amount: 100, fromPartySize: 1, refundNote: { zh_hk: '', en: '' } }
export const ROOM = { periodKey: null, periodFirst: null, periodLast: null, perSlot: 10, perMeal: null }

export function paymentWorld(start = new Date('2026-12-01T10:00:00Z')) {
  let clock = start.getTime()
  const now = () => new Date(clock)
  const advance = (ms: number) => void (clock += ms)
  const gateway = new TestPaymentGateway({ secret: WEBHOOK_SECRET, now })
  gateway.addAccount(ACCOUNT_REF)
  const registry = createPaymentGatewayRegistry({ test: () => gateway })
  const ledger = new FakeDepositLedger(now)
  const accounts = new FakeAccounts()
  const account: MerchantPaymentAccount = accounts.set({ restaurantId: RESTAURANT, providerAccountId: ACCOUNT_REF })
  const claims = new FakeWebhookClaims()
  const { log, lines } = memoryLog()
  const paidHook: DepositPaid[] = []
  const tokens: string[] = []

  const startDeps: StartDepositDeps = {
    registry, deposits: ledger, appBaseUrl: APP_URL, newId: randomUUID,
    mintToken: () => {
      const t = mintPaymentLinkToken()
      tokens.push(t.token)
      return t
    },
    now, log,
  }
  const webhookDeps: ProcessPaymentWebhookDeps = {
    gateway, claims, deposits: ledger, registry, now, log, onDepositPaid: async (p) => void paidHook.push(p),
  }
  const expireDeps: ExpireDepositsDeps = { deposits: ledger, registry, log }
  const decisionDeps: DepositDecisionDeps = { deposits: ledger, registry, log, now }
  const linkDeps: ResolvePaymentLinkDeps = { deposits: ledger, registry, now, log }

  const request = (over: Partial<NewBookingRequest> = {}): NewBookingRequest => ({
    restaurantId: RESTAURANT, memberId: null, phone: '+85291234567', name: 'Chan', partySize: 4, bookingDate: '2026-12-24',
    bookingTime: '19:00', notes: null, source: 'chat', campaignId: null, token: null, ...over,
  })

  /** A diner-channel booking with a deposit, as W3 will call it. */
  const book = (over: Partial<NewBookingRequest> = {}, opts: { rule?: DepositRule; holder?: DepositHolder; account?: MerchantPaymentAccount | null } = {}) => {
    const req = request(over)
    return startDeposit(startDeps, {
      restaurantId: req.restaurantId, rule: opts.rule ?? PER_GUEST_100, account: opts.account === undefined ? account : opts.account,
      partySize: req.partySize, holder: opts.holder ?? 'diner', restaurantName: 'Café A', bookingDate: req.bookingDate,
      bookingTime: req.bookingTime, insertBooking: (hold) => ledger.insertWithDeposit(req, ROOM, hold, 3),
    })
  }

  const deliver = (delivery: SignedDelivery) => processPaymentWebhook(webhookDeps, delivery)

  return {
    gateway, registry, ledger, accounts, account, claims, log, lines, paidHook, tokens, now, advance,
    startDeps, webhookDeps, expireDeps, decisionDeps, linkDeps, request, book, deliver,
  }
}

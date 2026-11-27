// BOOK-014 W2 (spec S1 AC-1, AC-4; threat R52): connecting a restaurant's
// payment account, re-reading its status, and the provider's account events,
// all on the in-repo test adapter through the production port.
import { describe, it, expect } from 'vitest'
import { connectPaymentAccount, refreshPaymentAccount, type PaymentAccountDeps } from '../payment-account'
import { processPaymentWebhook, type ProcessPaymentWebhookDeps } from '../process-payment-webhook'
import { startDeposit } from '../start-deposit'
import { createPaymentGatewayRegistry } from '@/infrastructure/payments/registry'
import { TestPaymentGateway } from '@/infrastructure/payments/test/test-gateway'
import { MemoryMerchantAccountStore } from '@/infrastructure/payments/test/memory-account-store'
import { FakeDepositLedger, FakeWebhookClaims, memoryLog } from '@/test-utils/fake-booking-deposit'
import { mintPaymentLinkToken } from '@/domain/services/payment-link-token'
import type { DepositRule } from '@/domain/value-objects/deposit-rule'
import type { PaymentGatewayPort } from '@/domain/ports/payment-gateway'

type OnboardingInput = Parameters<PaymentGatewayPort['createOnboardingLink']>[0]

const RID = 'rest-a'
const OTHER = 'rest-b'
const APP = 'https://app.example.test'
const RULE: DepositRule = { enabled: true, mode: 'per_guest', amount: 100, fromPartySize: 1, refundNote: { zh_hk: '', en: '' } }

function world() {
  const now = () => new Date('2026-12-01T10:00:00Z')
  const gateway = new TestPaymentGateway({ secret: 's3cret', now })
  const registry = createPaymentGatewayRegistry({ test: () => gateway })
  const accounts = new MemoryMerchantAccountStore()
  const { log, lines } = memoryLog()
  const order: string[] = []
  accounts.onWrite = (op) => order.push(op)
  const create = gateway.createOnboardingLink.bind(gateway)
  gateway.createOnboardingLink = async (input: OnboardingInput) => {
    order.push('link')
    return create(input)
  }
  const deps: PaymentAccountDeps = { registry, accounts, onboardingProvider: 'test', appBaseUrl: APP, now, log }
  const ledger = new FakeDepositLedger(now)
  const webhookDeps: ProcessPaymentWebhookDeps = {
    gateway, claims: new FakeWebhookClaims(), deposits: ledger, registry, accounts, now, log,
  }
  const event = (body: Record<string, unknown>) => processPaymentWebhook(webhookDeps, gateway.signedEvent({ livemode: false, ...body } as never))
  return { gateway, registry, accounts, deps, order, lines, ledger, event, now }
}

describe('connectPaymentAccount (AC-1, R52)', () => {
  it('no account: creates one at the provider and stores its id BEFORE the onboarding link is issued', async () => {
    const w = world()
    const result = await connectPaymentAccount(w.deps, { restaurantId: RID })
    expect(result.kind).toBe('link')
    const stored = await w.accounts.findForRestaurant(RID)
    expect(stored).toMatchObject({ restaurantId: RID, providerCode: 'test', status: 'pending', chargesEnabled: false })
    expect(stored?.providerAccountId).toMatch(/^acct_test_/)
    expect(w.order).toEqual(['link_account', 'link'])
    if (result.kind === 'link') expect(result.url).toBe(`https://pay.test.invalid/onboard/${stored?.providerAccountId}`)
  })

  it('the return and refresh URLs land on Settings → Booking and carry no account id', async () => {
    const w = world()
    const seen: Array<{ returnUrl: string; refreshUrl: string }> = []
    const original = w.gateway.createOnboardingLink
    w.gateway.createOnboardingLink = async (input: OnboardingInput) => {
      seen.push({ returnUrl: input.returnUrl, refreshUrl: input.refreshUrl })
      return original(input)
    }
    await connectPaymentAccount(w.deps, { restaurantId: RID })
    expect(seen).toEqual([{ returnUrl: `${APP}/dashboard/setup/bookings?payments=return`, refreshUrl: `${APP}/dashboard/setup/bookings?payments=refresh` }])
    expect(JSON.stringify(seen)).not.toContain('acct_')
  })

  it('a pending account: no second provider account; a new link for the stored one ("Continue setup")', async () => {
    const w = world()
    await connectPaymentAccount(w.deps, { restaurantId: RID })
    const first = await w.accounts.findForRestaurant(RID)
    const again = await connectPaymentAccount(w.deps, { restaurantId: RID })
    expect(again.kind).toBe('link')
    expect(w.gateway.calls.createAccount).toBe(1)
    expect((await w.accounts.findForRestaurant(RID))?.providerAccountId).toBe(first?.providerAccountId)
  })

  it('an active account: already_active, no provider call', async () => {
    const w = world()
    w.accounts.seed({ restaurantId: RID, providerCode: 'test', providerAccountId: 'acct_test_A', status: 'active', chargesEnabled: true, currency: 'HKD' })
    expect(await connectPaymentAccount(w.deps, { restaurantId: RID })).toEqual({ kind: 'already_active' })
    expect(w.gateway.calls.createAccount).toBe(0)
  })

  it('a disconnected account is replaced by a new provider account, back to pending', async () => {
    const w = world()
    w.accounts.seed({ restaurantId: RID, providerCode: 'test', providerAccountId: 'acct_old', status: 'disabled' })
    const result = await connectPaymentAccount(w.deps, { restaurantId: RID })
    expect(result.kind).toBe('link')
    const row = await w.accounts.findForRestaurant(RID)
    expect(row?.providerAccountId).not.toBe('acct_old')
    expect(row?.status).toBe('pending')
  })

  it('the provider is down at create: unavailable, nothing stored', async () => {
    const w = world()
    w.gateway.failNext('createAccount')
    expect(await connectPaymentAccount(w.deps, { restaurantId: RID })).toEqual({ kind: 'unavailable' })
    expect(await w.accounts.findForRestaurant(RID)).toBeNull()
  })

  it('no public app URL: unavailable before any provider call', async () => {
    const w = world()
    expect(await connectPaymentAccount({ ...w.deps, appBaseUrl: '' }, { restaurantId: RID })).toEqual({ kind: 'unavailable' })
    expect(w.gateway.calls.createAccount).toBe(0)
  })
})

describe('refreshPaymentAccount: the return page only re-reads the provider (R52)', () => {
  it('re-reads the STORED account and maps charges enabled + currency to active', async () => {
    const w = world()
    await connectPaymentAccount(w.deps, { restaurantId: RID })
    const stored = await w.accounts.findForRestaurant(RID)
    w.gateway.addAccount(stored!.providerAccountId!, { chargesEnabled: true, detailsSubmitted: true, currency: 'HKD' })
    const refreshed = await refreshPaymentAccount(w.deps, { restaurantId: RID })
    expect(refreshed).toMatchObject({ status: 'active', chargesEnabled: true, currency: 'HKD', providerAccountId: stored!.providerAccountId })
    expect(w.gateway.calls.getAccountStatus).toBe(1)
  })

  it('details submitted but the provider disabled charges: restricted with its reason (Action needed)', async () => {
    const w = world()
    w.accounts.seed({ restaurantId: RID, providerCode: 'test', providerAccountId: 'acct_test_A' })
    w.gateway.addAccount('acct_test_A', { chargesEnabled: false, detailsSubmitted: true, currency: 'HKD', disabledReason: 'requirements.past_due' })
    expect(await refreshPaymentAccount(w.deps, { restaurantId: RID })).toMatchObject({ status: 'restricted', restrictionReason: 'requirements.past_due' })
  })

  it('onboarding unfinished stays pending (Connecting)', async () => {
    const w = world()
    w.accounts.seed({ restaurantId: RID, providerCode: 'test', providerAccountId: 'acct_test_A' })
    w.gateway.addAccount('acct_test_A', { chargesEnabled: false, detailsSubmitted: false, currency: null, disabledReason: 'requirements.past_due' })
    expect(await refreshPaymentAccount(w.deps, { restaurantId: RID })).toMatchObject({ status: 'pending' })
  })

  it('no account: null and no provider call', async () => {
    const w = world()
    expect(await refreshPaymentAccount(w.deps, { restaurantId: RID })).toBeNull()
    expect(w.gateway.calls.getAccountStatus).toBe(0)
  })

  it('a disconnected account is not re-read (the platform lost access)', async () => {
    const w = world()
    w.accounts.seed({ restaurantId: RID, providerCode: 'test', providerAccountId: 'acct_test_A', status: 'disabled' })
    expect(await refreshPaymentAccount(w.deps, { restaurantId: RID })).toMatchObject({ status: 'disabled' })
    expect(w.gateway.calls.getAccountStatus).toBe(0)
  })

  it('the provider is down: the stored status comes back unchanged', async () => {
    const w = world()
    w.accounts.seed({ restaurantId: RID, providerCode: 'test', providerAccountId: 'acct_missing' })
    expect(await refreshPaymentAccount(w.deps, { restaurantId: RID })).toMatchObject({ status: 'pending', providerAccountId: 'acct_missing' })
  })
})

describe('account events from the provider (R52)', () => {
  it('account_updated for our stored account → active', async () => {
    const w = world()
    w.accounts.seed({ restaurantId: RID, providerCode: 'test', providerAccountId: 'acct_test_A' })
    const res = await w.event({ id: 'evt_1', type: 'account.updated', account: 'acct_test_A', charges: true, currency: 'HKD' })
    expect(res).toEqual({ status: 200, body: { received: true, outcomes: ['account_updated'] } })
    expect(await w.accounts.findForRestaurant(RID)).toMatchObject({ status: 'active', chargesEnabled: true, currency: 'HKD' })
  })

  it('an account id we never stored changes nothing (matched by our stored id only)', async () => {
    const w = world()
    w.accounts.seed({ restaurantId: RID, providerCode: 'test', providerAccountId: 'acct_test_A' })
    const res = await w.event({ id: 'evt_2', type: 'account.updated', account: 'acct_attacker', charges: true, currency: 'HKD' })
    expect(res.body).toEqual({ received: true, outcomes: ['ignored'] })
    expect(await w.accounts.findForRestaurant(RID)).toMatchObject({ status: 'pending' })
    expect(w.accounts.rows.size).toBe(1)
  })

  it('AC-4: deauthorized → disabled, and the next startDeposit is not_required (booking proceeds without a deposit)', async () => {
    const w = world()
    w.accounts.seed({ restaurantId: RID, providerCode: 'test', providerAccountId: 'acct_test_A', status: 'active', chargesEnabled: true, currency: 'HKD' })
    w.gateway.addAccount('acct_test_A')
    const res = await w.event({ id: 'evt_3', type: 'account.deauthorized', account: 'acct_test_A' })
    expect(res.body).toEqual({ received: true, outcomes: ['account_updated'] })
    const account = await w.accounts.findForRestaurant(RID)
    expect(account).toMatchObject({ status: 'disabled', chargesEnabled: false })

    const link = mintPaymentLinkToken()
    let inserted = 0
    const result = await startDeposit(
      { registry: w.registry, deposits: w.ledger, appBaseUrl: APP, newId: () => 'dep-1', mintToken: () => link, now: w.now, log: () => {} },
      {
        restaurantId: RID, rule: RULE, account, partySize: 4, holder: 'diner', restaurantName: 'Café A', bookingDate: '2026-12-24', bookingTime: '19:00',
        insertBooking: async () => {
          inserted += 1
          throw new Error('must not insert a deposit hold')
        },
      }
    )
    expect(result).toEqual({ kind: 'not_required' })
    expect(inserted).toBe(0)
    expect(w.gateway.calls.createHostedPayment).toBe(0)
  })

  it('a late account_updated after the deauthorization does not re-activate it', async () => {
    const w = world()
    w.accounts.seed({ restaurantId: RID, providerCode: 'test', providerAccountId: 'acct_test_A', status: 'disabled' })
    const res = await w.event({ id: 'evt_4', type: 'account.updated', account: 'acct_test_A', charges: true, currency: 'HKD' })
    expect(res.body).toEqual({ received: true, outcomes: ['ignored'] })
    expect(await w.accounts.findForRestaurant(RID)).toMatchObject({ status: 'disabled' })
  })

  it('another restaurant’s account event never touches this one', async () => {
    const w = world()
    w.accounts.seed({ restaurantId: RID, providerCode: 'test', providerAccountId: 'acct_test_A' })
    w.accounts.seed({ restaurantId: OTHER, providerCode: 'test', providerAccountId: 'acct_test_B' })
    await w.event({ id: 'evt_5', type: 'account.deauthorized', account: 'acct_test_B' })
    expect(await w.accounts.findForRestaurant(RID)).toMatchObject({ status: 'pending' })
    expect(await w.accounts.findForRestaurant(OTHER)).toMatchObject({ status: 'disabled' })
  })
})

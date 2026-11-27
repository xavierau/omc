// BOOK-014 W2 (spec S1 AC-1, AC-2; threat R52, R58): Settings → Booking →
// Payments. POST connect is admin only and creates + stores the provider
// account server side before returning the onboarding link; GET is any tenant
// member (status only); a return URL never supplies an account id.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/application/payments/payment-deps', () => ({ paymentAccountDeps: vi.fn() }))

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { paymentAccountDeps } from '@/application/payments/payment-deps'
import { createPaymentGatewayRegistry } from '@/infrastructure/payments/registry'
import { TestPaymentGateway } from '@/infrastructure/payments/test/test-gateway'
import { MemoryMerchantAccountStore } from '@/infrastructure/payments/test/memory-account-store'
import { GET } from '../route'
import { POST } from '../connect/route'

const RID = 'rest-1'
let gateway: TestPaymentGateway
let accounts: MemoryMerchantAccountStore

function as(role: string, restaurantId = RID) {
  vi.mocked(getTenantContext).mockResolvedValue({ userId: 'u-1', restaurantId, role, tenantStatus: 'active' })
}

const get = (query = '') => GET(new NextRequest(`http://localhost/api/dashboard/settings/payments${query}`))
// POST takes no request: no body can name an account or a restaurant (R52, R58).
const connect = () => POST()

beforeEach(() => {
  vi.clearAllMocks()
  gateway = new TestPaymentGateway({ secret: 's' })
  accounts = new MemoryMerchantAccountStore()
  vi.mocked(paymentAccountDeps).mockReturnValue({
    registry: createPaymentGatewayRegistry({ test: () => gateway }), accounts, onboardingProvider: 'test',
    appBaseUrl: 'https://app.example.test', now: () => new Date('2026-12-01T10:00:00Z'), log: () => {},
  })
})

describe('POST /api/dashboard/settings/payments/connect', () => {
  it('staff → 403, no provider call, nothing stored (AC-2, R58)', async () => {
    as('staff')
    const res = await connect()
    expect(res.status).toBe(403)
    expect(gateway.calls.createAccount).toBe(0)
    expect(accounts.rows.size).toBe(0)
  })

  it('admin → 200 with the onboarding link; the account id was stored for the session restaurant first (R52)', async () => {
    as('admin')
    const res = await connect()
    expect(res.status).toBe(200)
    const body = await res.json()
    const stored = await accounts.findForRestaurant(RID)
    expect(stored?.providerAccountId).toMatch(/^acct_test_/)
    expect(body).toEqual({ url: `https://pay.test.invalid/onboard/${stored?.providerAccountId}` })
  })

  it('only the session restaurant’s row is used; another restaurant’s account is untouched', async () => {
    as('admin')
    accounts.seed({ restaurantId: 'rest-2', providerCode: 'test', providerAccountId: 'acct_victim' })
    const res = await connect()
    expect(res.status).toBe(200)
    expect((await accounts.findForRestaurant(RID))?.providerAccountId).not.toBe('acct_victim')
    expect(await accounts.findForRestaurant('rest-2')).toMatchObject({ providerAccountId: 'acct_victim', status: 'pending' })
  })

  it('already active → 409', async () => {
    as('admin')
    accounts.seed({ restaurantId: RID, providerCode: 'test', providerAccountId: 'acct_A', status: 'active', chargesEnabled: true, currency: 'HKD' })
    const res = await connect()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'already_active' })
  })

  it('the provider is down → 502 provider_unavailable (the UI says "Couldn\'t reach Stripe")', async () => {
    as('admin')
    gateway.failNext('createAccount')
    const res = await connect()
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'provider_unavailable' })
  })
})

describe('GET /api/dashboard/settings/payments', () => {
  it('staff sees the status (no account id) and canManage false (AC-2)', async () => {
    as('staff')
    accounts.seed({ restaurantId: RID, providerCode: 'test', providerAccountId: 'acct_A', status: 'restricted', restrictionReason: 'requirements.past_due' })
    const res = await get()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      account: { provider: 'test', status: 'restricted', chargesEnabled: false, currency: null, restrictionReason: 'requirements.past_due' },
      canManage: false,
    })
    expect(JSON.stringify(body)).not.toContain('acct_A')
  })

  it('no account → account null; admin canManage true', async () => {
    as('admin')
    expect(await (await get()).json()).toEqual({ account: null, canManage: true })
  })

  it('return with ?account=acct_x changes nothing: only the STORED account is re-read from the provider (R52)', async () => {
    as('admin')
    accounts.seed({ restaurantId: RID, providerCode: 'test', providerAccountId: 'acct_A' })
    gateway.addAccount('acct_A', { chargesEnabled: false, detailsSubmitted: false, currency: null })
    gateway.addAccount('acct_x', { chargesEnabled: true, detailsSubmitted: true, currency: 'HKD' })
    const res = await get('?payments=return&refresh=1&account=acct_x')
    expect((await res.json()).account).toMatchObject({ status: 'pending', chargesEnabled: false })
    const row = await accounts.findForRestaurant(RID)
    expect(row).toMatchObject({ providerAccountId: 'acct_A', status: 'pending' })
    expect(accounts.rows.size).toBe(1)
  })

  it('refresh=1 re-reads the provider and returns the new status', async () => {
    as('admin')
    accounts.seed({ restaurantId: RID, providerCode: 'test', providerAccountId: 'acct_A' })
    gateway.addAccount('acct_A', { chargesEnabled: true, detailsSubmitted: true, currency: 'HKD' })
    expect((await (await get('?refresh=1')).json()).account).toMatchObject({ status: 'active', currency: 'HKD' })
  })

  it('staff refresh=1 reads the stored status only (no provider call)', async () => {
    as('staff')
    accounts.seed({ restaurantId: RID, providerCode: 'test', providerAccountId: 'acct_A' })
    gateway.addAccount('acct_A', { chargesEnabled: true, detailsSubmitted: true, currency: 'HKD' })
    expect((await (await get('?refresh=1')).json()).account).toMatchObject({ status: 'pending' })
    expect(gateway.calls.getAccountStatus).toBe(0)
  })

  it('another restaurant’s account is never shown', async () => {
    as('admin', 'rest-2')
    accounts.seed({ restaurantId: RID, providerCode: 'test', providerAccountId: 'acct_A', status: 'active', chargesEnabled: true, currency: 'HKD' })
    expect((await (await get()).json()).account).toBeNull()
  })

  it('no session → 401', async () => {
    const { AuthError } = await import('@/infrastructure/supabase/guards/auth-guard')
    vi.mocked(getTenantContext).mockRejectedValue(new AuthError('Unauthorized', 401))
    expect((await get()).status).toBe(401)
  })
})

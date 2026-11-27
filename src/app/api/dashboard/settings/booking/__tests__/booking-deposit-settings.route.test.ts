// BOOK-014 W2 (spec S2 AC-3, AC-4; threat R52, R53, R58): the deposit rule
// rides in the booking settings PUT. Admin only; it can be turned on only
// while the restaurant's payment account is active (409 otherwise); the
// amount, minimum, cap and party size are validated (400).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/infrastructure/supabase/repositories/booking-config-repository')
vi.mock('@/infrastructure/supabase/repositories/merchant-payment-account-repository')
vi.mock('@/application/booking/booking-template-deps', () => ({
  bookingTemplateOverviewFor: vi.fn(),
  bookingTemplateStatusesFor: vi.fn().mockResolvedValue(null),
  provisionBookingTemplatesFor: vi.fn().mockResolvedValue(null),
}))

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { getBookingConfig, saveBookingSettings } from '@/infrastructure/supabase/repositories/booking-config-repository'
import { findPaymentAccountForRestaurant } from '@/infrastructure/supabase/repositories/merchant-payment-account-repository'
import { DEFAULT_BOOKING_CONFIG, type BookingConfig } from '@/domain/value-objects/booking-config'
import type { DepositRule } from '@/domain/value-objects/deposit-rule'
import type { MerchantPaymentAccount } from '@/domain/entities/merchant-payment-account'
import { PUT } from '../route'

const RID = 'rest-1'
const RULE: DepositRule = { enabled: true, mode: 'per_guest', amount: 100, fromPartySize: 6, refundNote: { zh_hk: '不設退款', en: 'No refunds' } }
const ACTIVE: MerchantPaymentAccount = {
  id: 'acc-1', restaurantId: RID, providerCode: 'stripe', providerAccountId: 'acct_1', status: 'active', chargesEnabled: true, currency: 'HKD', restrictionReason: null,
}
const stored = (patch: Partial<BookingConfig> = {}): BookingConfig => ({ ...structuredClone(DEFAULT_BOOKING_CONFIG), mode: 'simple', ...patch })

function req(body: unknown) {
  return new NextRequest('http://localhost/api/dashboard/settings/booking', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

function as(role: string) {
  vi.mocked(getTenantContext).mockResolvedValue({ userId: 'u-1', restaurantId: RID, role, tenantStatus: 'active' })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getBookingConfig).mockResolvedValue(stored())
  vi.mocked(saveBookingSettings).mockResolvedValue()
  vi.mocked(findPaymentAccountForRestaurant).mockResolvedValue(ACTIVE)
})

describe('PUT /api/dashboard/settings/booking: deposit rule', () => {
  it('staff → 403, nothing saved (AC-2, R58)', async () => {
    as('staff')
    expect((await PUT(req({ mode: 'simple', deposit: RULE }))).status).toBe(403)
    expect(saveBookingSettings).not.toHaveBeenCalled()
  })

  it('admin with an active account → 200, rule saved for the session restaurant', async () => {
    as('admin')
    const res = await PUT(req({ mode: 'simple', deposit: RULE }))
    expect(res.status).toBe(200)
    expect(vi.mocked(saveBookingSettings).mock.calls[0]).toEqual([RID, expect.objectContaining({ deposit: RULE })])
    expect(findPaymentAccountForRestaurant).toHaveBeenCalledWith(RID)
  })

  it.each([
    ['no account', null],
    ['pending', { ...ACTIVE, status: 'pending', chargesEnabled: false }],
    ['restricted', { ...ACTIVE, status: 'restricted', chargesEnabled: false, restrictionReason: 'requirements.past_due' }],
    ['disabled', { ...ACTIVE, status: 'disabled', chargesEnabled: false }],
  ] as const)('turning it on with %s → 409, nothing saved (R52, AC-4)', async (_label, account) => {
    as('admin')
    vi.mocked(findPaymentAccountForRestaurant).mockResolvedValue(account as MerchantPaymentAccount | null)
    const res = await PUT(req({ mode: 'simple', deposit: RULE }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'payment_account_not_active' })
    expect(saveBookingSettings).not.toHaveBeenCalled()
  })

  it('a rule already on stays savable after the account went inactive (other edits are not blocked; deposits are paused)', async () => {
    as('admin')
    vi.mocked(getBookingConfig).mockResolvedValue(stored({ deposit: RULE }))
    vi.mocked(findPaymentAccountForRestaurant).mockResolvedValue({ ...ACTIVE, status: 'disabled', chargesEnabled: false })
    expect((await PUT(req({ mode: 'simple', bookingRules: 'set menu only', deposit: RULE }))).status).toBe(200)
  })

  it('turning it off never needs an account', async () => {
    as('admin')
    vi.mocked(getBookingConfig).mockResolvedValue(stored({ deposit: RULE }))
    vi.mocked(findPaymentAccountForRestaurant).mockResolvedValue(null)
    const res = await PUT(req({ mode: 'simple', deposit: { ...RULE, enabled: false } }))
    expect(res.status).toBe(200)
    expect(vi.mocked(saveBookingSettings).mock.calls[0][1].deposit.enabled).toBe(false)
  })

  it.each([
    ['amount 0', { amount: 0 }, 'deposit.amount'],
    ['amount over the HK$10,000 cap', { amount: 10_001 }, 'deposit.amount'],
    ['amount below HK$4', { amount: 3 }, 'deposit.amount'],
    ['amount not whole', { amount: 99.5 }, 'deposit.amount'],
    ['party size 0', { fromPartySize: 0 }, 'deposit.fromPartySize'],
  ])('%s → 400 with the field, nothing saved (R53)', async (_label, patch, field) => {
    as('admin')
    const res = await PUT(req({ mode: 'simple', deposit: { ...RULE, ...patch } }))
    expect(res.status).toBe(400)
    expect((await res.json()).fields).toMatchObject({ [field]: 'invalid' })
    expect(saveBookingSettings).not.toHaveBeenCalled()
  })

  it('a save without a deposit keeps the stored rule and never reads the account', async () => {
    as('admin')
    vi.mocked(getBookingConfig).mockResolvedValue(stored({ deposit: RULE }))
    expect((await PUT(req({ mode: 'simple' }))).status).toBe(200)
    expect(vi.mocked(saveBookingSettings).mock.calls[0][1].deposit).toEqual(RULE)
    expect(findPaymentAccountForRestaurant).not.toHaveBeenCalled()
  })
})

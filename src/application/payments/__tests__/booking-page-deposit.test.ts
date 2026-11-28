// BOOK-014 W3 (spec AC-3, AC-4, AC-5): what the /b page shows before the
// diner submits. A plan (rule + the account's currency) only while the rule is
// on and the account can take charges; the amount per party comes from the
// same domain function the server charges with (R53).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { bookingPageDepositPlan, type BookingPageDepositDeps } from '../booking-page-deposit'
import { FakeBookingSettings, FakeBookingTokens } from '@/test-utils/fake-booking'
import { FakeAccounts } from '@/test-utils/fake-booking-deposit'
import { PER_GUEST_100 } from '@/test-utils/payment-world'

const A = 'rest-a'
const TOKEN = 'A'.repeat(43)

let settings: FakeBookingSettings
let accounts: FakeAccounts
let deps: BookingPageDepositDeps

beforeEach(() => {
  const tokens = new FakeBookingTokens()
  tokens.add({ token: TOKEN, restaurantId: A, phone: '+85291234567' })
  settings = new FakeBookingSettings()
  settings.setConfig(A, { mode: 'simple', deposit: { ...PER_GUEST_100, fromPartySize: 3 } })
  accounts = new FakeAccounts()
  accounts.set({ restaurantId: A })
  deps = { tokens, settings, accounts, now: () => new Date('2026-12-01T02:00:00Z') }
})

describe('bookingPageDepositPlan', () => {
  it('rule on + chargeable account -> the rule and the account currency', async () => {
    expect(await bookingPageDepositPlan(deps, TOKEN)).toEqual({
      mode: 'per_guest', amount: 100, fromPartySize: 3, currency: 'HKD',
    })
  })

  it('rule off -> null, the account is not read', async () => {
    settings.setConfig(A, { mode: 'simple' })
    const find = vi.spyOn(accounts, 'findForRestaurant')
    expect(await bookingPageDepositPlan(deps, TOKEN)).toBeNull()
    expect(find).not.toHaveBeenCalled()
  })

  it('AC-4: account restricted or missing -> null (no deposit is asked)', async () => {
    accounts.set({ restaurantId: A, status: 'restricted', chargesEnabled: false })
    expect(await bookingPageDepositPlan(deps, TOKEN)).toBeNull()
    accounts.rows.clear()
    expect(await bookingPageDepositPlan(deps, TOKEN)).toBeNull()
  })

  it('unknown token -> null; a read failure -> null (the submit still enforces the deposit)', async () => {
    expect(await bookingPageDepositPlan(deps, 'Z'.repeat(43))).toBeNull()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(accounts, 'findForRestaurant').mockRejectedValueOnce(new Error('db down'))
    expect(await bookingPageDepositPlan(deps, TOKEN)).toBeNull()
  })
})

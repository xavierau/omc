/**
 * BOOK-014 W3 (spec AC-3, AC-4, AC-5): the deposit the /b page shows before
 * the diner submits, or null. A plan only while the stored rule is on and the
 * restaurant's account can take charges (AC-4: otherwise bookings go without
 * one). Read-only and best effort: a failure gives null and the page still
 * works; the submit is what enforces the deposit (startDeposit).
 */
import { isChargeable } from '@/domain/entities/merchant-payment-account'
import type { BookingSettingsReader, BookingTokenStore } from '@/domain/ports/booking'
import type { MerchantPaymentAccountReader } from '@/domain/ports/booking-deposit'
import { depositPlanOf, type DepositPlan } from '@/domain/value-objects/deposit-plan'

export interface BookingPageDepositDeps {
  tokens: Pick<BookingTokenStore, 'peek'>
  settings: Pick<BookingSettingsReader, 'getConfig'>
  accounts: MerchantPaymentAccountReader
  now: () => Date
}

export async function bookingPageDepositPlan(deps: BookingPageDepositDeps, token: string): Promise<DepositPlan | null> {
  try {
    const { owner } = await deps.tokens.peek(token, deps.now())
    if (!owner) return null
    const { deposit } = await deps.settings.getConfig(owner.restaurantId)
    if (!deposit.enabled) return null
    const account = await deps.accounts.findForRestaurant(owner.restaurantId)
    return isChargeable(account) ? depositPlanOf(deposit, account.currency) : null
  } catch (err) {
    console.warn('[Payments] booking page deposit plan unavailable:', (err as Error).name)
    return null
  }
}

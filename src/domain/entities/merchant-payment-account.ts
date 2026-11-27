/**
 * BOOK-014: a restaurant's account at a payment provider (table
 * `merchant_payment_accounts`, migration 097; commerce ADR entity, deposit
 * slice). With Stripe Connect Standard and direct charges, the provider
 * account id is all we store: calls use the platform key scoped to it.
 */
import type { PaymentProviderCode } from '@/domain/ports/payment-gateway'

export type MerchantAccountStatus = 'pending' | 'active' | 'restricted' | 'disabled'

export interface MerchantPaymentAccount {
  id: string
  restaurantId: string
  providerCode: PaymentProviderCode
  providerAccountId: string | null
  status: MerchantAccountStatus
  chargesEnabled: boolean
  /** The account's settlement currency (ISO, upper case); deposits are charged in it. */
  currency: string | null
  restrictionReason: string | null
}

/** An account ready to take a deposit (spec AC-4: otherwise bookings are taken without one). */
export interface ChargeableAccount extends MerchantPaymentAccount {
  providerAccountId: string
  currency: string
}

export function isChargeable(account: MerchantPaymentAccount | null): account is ChargeableAccount {
  return (
    account !== null &&
    account.status === 'active' &&
    account.chargesEnabled &&
    account.providerAccountId !== null &&
    account.currency !== null
  )
}

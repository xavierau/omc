/**
 * BOOK-014: a restaurant's account at a payment provider (table
 * `merchant_payment_accounts`, migration 096; commerce ADR entity, deposit
 * slice). With Stripe Connect Standard and direct charges, the provider
 * account id is all we store: calls use the platform key scoped to it.
 */
import type { PaymentProviderCode, ProviderAccountStatus } from '@/domain/ports/payment-gateway'

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

/** BOOK-014 W2: what a provider status (or a deauthorization) writes onto the account row. */
export interface MerchantAccountUpdate {
  status: MerchantAccountStatus
  chargesEnabled: boolean
  detailsSubmitted: boolean
  currency: string | null
  restrictionReason: string | null
}

/** Reasons that mean "the provider is still checking", not "the admin must act" (spec: Connecting, not Action needed). */
const STILL_CONNECTING = new Set(['requirements.pending_verification', 'under_review'])
const REASON_MAX = 200

/**
 * Spec AC-1: the account's state comes from the provider's status only.
 * Active = charges enabled in a known currency; Connecting (pending) =
 * onboarding unfinished or under review; Action needed (restricted) = the
 * provider disabled charges after the details were sent, or rejected it.
 */
export function accountUpdateFrom(status: ProviderAccountStatus): MerchantAccountUpdate {
  const { chargesEnabled, detailsSubmitted, currency } = status
  if (chargesEnabled && currency) return { status: 'active', chargesEnabled, detailsSubmitted, currency, restrictionReason: null }
  const reason = status.disabledReason ? status.disabledReason.slice(0, REASON_MAX) : null
  const rejected = reason?.startsWith('rejected.') === true
  const connecting = !rejected && (!detailsSubmitted || reason === null || STILL_CONNECTING.has(reason))
  return { status: connecting ? 'pending' : 'restricted', chargesEnabled, detailsSubmitted, currency, restrictionReason: reason }
}

/** The restaurant disconnected the platform: terminal for that provider account id (spec AC-4). */
export const DEAUTHORIZED_UPDATE: MerchantAccountUpdate = {
  status: 'disabled',
  chargesEnabled: false,
  detailsSubmitted: false,
  currency: null,
  restrictionReason: 'deauthorized',
}

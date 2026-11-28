/**
 * BOOK-014 W2 (spec S1 AC-1, AC-4; threat R52, R58): a restaurant's payment
 * account at the provider.
 *
 * - connect: the provider account is created HERE, server side, and its id
 *   stored before any onboarding link is issued (R52). The return and refresh
 *   URLs point back at Settings → Booking and carry no account id.
 * - refresh: the return page only re-reads the STORED account's status from
 *   the provider; nothing in the URL is ever read as an account id.
 * - account events: the provider's account_updated / account_deauthorized
 *   find the row only by the provider account id we stored. A deauthorized
 *   account is terminal (disabled) and every channel then books without a
 *   deposit (startDeposit sees no chargeable account, AC-4).
 *   W6-fix F6: events can arrive out of order, so an account_updated older
 *   (by the provider's event time) than the last one applied is skipped. A
 *   deauthorization always applies (it is terminal).
 *
 * The restaurant id always comes from the session (the routes); nothing here
 * takes a provider account id from a caller.
 */
import { DEAUTHORIZED_UPDATE, accountUpdateFrom, type MerchantPaymentAccount } from '@/domain/entities/merchant-payment-account'
import type { MerchantPaymentAccountStore, PaymentLog } from '@/domain/ports/booking-deposit'
import type { NormalizedPaymentEvent, PaymentGatewayPort, PaymentGatewayRegistry, PaymentProviderCode } from '@/domain/ports/payment-gateway'

export interface PaymentAccountDeps {
  registry: PaymentGatewayRegistry
  accounts: MerchantPaymentAccountStore
  /** The provider a new account is opened with (Stripe today; a region may pick another). */
  onboardingProvider: PaymentProviderCode
  /** The public app URL; the return and refresh URLs are built on it, server side. */
  appBaseUrl: string
  now: () => Date
  log: PaymentLog
}

/** Where the provider sends the admin back: the booking settings group (decide_yourself). */
export const PAYMENTS_RETURN_PATH = '/dashboard/setup/bookings'

export function onboardingUrls(base: string): { returnUrl: string; refreshUrl: string } {
  return { returnUrl: `${base}${PAYMENTS_RETURN_PATH}?payments=return`, refreshUrl: `${base}${PAYMENTS_RETURN_PATH}?payments=refresh` }
}

export type ConnectPaymentAccountResult = { kind: 'link'; url: string } | { kind: 'already_active' } | { kind: 'unavailable' }

function publicBase(raw: string): string | null {
  const base = raw.trim().replace(/\/+$/, '')
  return /^https?:\/\/[^\s/]+/.test(base) ? base : null
}

function gatewayFor(deps: Pick<PaymentAccountDeps, 'registry' | 'log'>, code: PaymentProviderCode, restaurantId: string): PaymentGatewayPort | null {
  try {
    return deps.registry.get(code)
  } catch (err) {
    deps.log('error', 'payment_account.gateway_unavailable', { restaurantId, provider: code, error: (err as Error).name })
    return null
  }
}

/** A provider account id for the restaurant's row: the stored one, or a new one created and stored first (R52). */
async function storedAccountRef(
  deps: PaymentAccountDeps,
  gateway: PaymentGatewayPort,
  restaurantId: string,
  existing: MerchantPaymentAccount | null
): Promise<string | null> {
  if (existing?.providerAccountId && existing.status !== 'disabled') return existing.providerAccountId
  const { accountRef } = await gateway.createAccount({ restaurantId })
  const row = existing
    ? await deps.accounts.relink({ restaurantId, accountId: existing.id, providerAccountId: accountRef })
    : await deps.accounts.link({ restaurantId, providerCode: gateway.code, providerAccountId: accountRef })
  if (!row?.providerAccountId) return null
  if (row.providerAccountId !== accountRef) deps.log('warn', 'payment_account.connect_raced', { restaurantId, accountId: row.id })
  return row.providerAccountId
}

export async function connectPaymentAccount(deps: PaymentAccountDeps, input: { restaurantId: string }): Promise<ConnectPaymentAccountResult> {
  const { restaurantId } = input
  const base = publicBase(deps.appBaseUrl)
  if (!base) {
    deps.log('error', 'payment_account.app_url_missing', { restaurantId })
    return { kind: 'unavailable' }
  }
  const gateway = gatewayFor(deps, deps.onboardingProvider, restaurantId)
  if (!gateway) return { kind: 'unavailable' }

  const existing = await deps.accounts.findForRestaurantByProvider(restaurantId, gateway.code)
  if (existing?.status === 'active' && existing.chargesEnabled) return { kind: 'already_active' }
  try {
    const accountRef = await storedAccountRef(deps, gateway, restaurantId, existing)
    if (!accountRef) return { kind: 'unavailable' }
    const { url } = await gateway.createOnboardingLink({ accountRef, ...onboardingUrls(base) })
    return { kind: 'link', url }
  } catch (err) {
    deps.log('error', 'payment_account.connect_failed', { restaurantId, provider: gateway.code, error: (err as Error).message })
    return { kind: 'unavailable' }
  }
}

/**
 * The return / refresh landing: re-read the stored account from its provider
 * and save what it says. A provider failure leaves the stored status as it was.
 */
export async function refreshPaymentAccount(deps: PaymentAccountDeps, input: { restaurantId: string }): Promise<MerchantPaymentAccount | null> {
  const account = await deps.accounts.findForRestaurant(input.restaurantId)
  if (!account?.providerAccountId || account.status === 'disabled') return account
  const gateway = gatewayFor(deps, account.providerCode, input.restaurantId)
  if (!gateway) return account
  try {
    const status = await gateway.getAccountStatus(account.providerAccountId)
    const updated = await deps.accounts.applyStatus({
      accountId: account.id, providerAccountId: account.providerAccountId, update: accountUpdateFrom(status), at: deps.now(),
    })
    return updated ?? account
  } catch (err) {
    deps.log('warn', 'payment_account.refresh_failed', { accountId: account.id, error: (err as Error).message })
    return account
  }
}

export interface AccountEventDeps {
  accounts: Pick<MerchantPaymentAccountStore, 'findByProviderAccount' | 'applyStatus'>
  now: () => Date
  log: PaymentLog
}

/** One verified account event; 'ignored' when it names no account we stored, or a disconnected one. */
export async function applyAccountEvent(
  deps: AccountEventDeps,
  code: PaymentProviderCode,
  event: Extract<NormalizedPaymentEvent, { type: 'account_updated' | 'account_deauthorized' }>
): Promise<'account_updated' | 'ignored'> {
  if (!event.accountRef) return 'ignored'
  const account = await deps.accounts.findByProviderAccount(code, event.accountRef)
  if (!account) {
    deps.log('info', 'payment_account.event_unknown_account', { eventId: event.eventId, type: event.type })
    return 'ignored'
  }
  if (account.status === 'disabled') return 'ignored'
  const deauthorized = event.type === 'account_deauthorized'
  const update = deauthorized ? DEAUTHORIZED_UPDATE : accountUpdateFrom(event.status)
  const eventAt = new Date(event.occurredAt)
  const ordered = !deauthorized && !Number.isNaN(eventAt.getTime())
  const applied = await deps.accounts.applyStatus({
    accountId: account.id, providerAccountId: event.accountRef, update, at: deps.now(), ...(ordered ? { eventAt } : {}),
  })
  if (!applied) {
    if (ordered) deps.log('info', 'payment_account.event_stale', { accountId: account.id, eventId: event.eventId, occurredAt: event.occurredAt })
    return 'ignored'
  }
  deps.log('info', 'payment_account.status', { accountId: account.id, eventId: event.eventId, status: applied.status })
  return 'account_updated'
}

/** What the dashboard sees: the state, never the provider account id. */
export interface PaymentAccountView {
  provider: PaymentProviderCode
  status: MerchantPaymentAccount['status']
  chargesEnabled: boolean
  currency: string | null
  restrictionReason: string | null
}

export function paymentAccountView(account: MerchantPaymentAccount | null): PaymentAccountView | null {
  if (!account) return null
  return {
    provider: account.providerCode,
    status: account.status,
    chargesEnabled: account.chargesEnabled,
    currency: account.currency,
    restrictionReason: account.restrictionReason,
  }
}

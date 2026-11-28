/**
 * BOOK-014 W2 (R52, R58): the write side of `merchant_payment_accounts`
 * (migration 096) for the onboarding routes and the provider's account
 * events. Staff-side lookups are scoped by restaurant in the query; provider
 * events find the row only by the provider account id WE stored, and a status
 * write lands only while the row still holds that id. Reads of the deposit
 * account stay in merchant-payment-account-repository.ts.
 */
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import type { MerchantAccountUpdate, MerchantPaymentAccount } from '@/domain/entities/merchant-payment-account'
import type { MerchantPaymentAccountStore } from '@/domain/ports/booking-deposit'
import type { PaymentProviderCode } from '@/domain/ports/payment-gateway'
import { findPaymentAccountForRestaurant, toAccount, type AccountRow } from './merchant-payment-account-repository'

/** Same columns as the reader's (the schema-contract test reads this literal). */
const ACCOUNT_COLUMNS = 'id, restaurant_id, provider_code, provider_account_id, status, charges_enabled, currency, restriction_reason, updated_at'

function oneAccount(op: string, result: { data: unknown; error: { code?: string; message: string } | null }): MerchantPaymentAccount | null {
  if (result.error?.code === '22P02') return null
  if (result.error) throw new Error(`${op}: ${result.error.message}`)
  return result.data ? toAccount(result.data as AccountRow) : null
}

async function findForRestaurantByProvider(restaurantId: string, providerCode: PaymentProviderCode) {
  const result = await createServerSupabaseClient()
    .from('merchant_payment_accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('restaurant_id', restaurantId)
    .eq('provider_code', providerCode)
    .maybeSingle()
  return oneAccount('findForRestaurantByProvider', result)
}

async function findByProviderAccount(providerCode: PaymentProviderCode, providerAccountId: string) {
  const result = await createServerSupabaseClient()
    .from('merchant_payment_accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('provider_code', providerCode)
    .eq('provider_account_id', providerAccountId)
    .maybeSingle()
  return oneAccount('findByProviderAccount', result)
}

/** R52: the provider account id is stored before any onboarding link; a concurrent connect's row wins. */
async function link(input: { restaurantId: string; providerCode: PaymentProviderCode; providerAccountId: string }) {
  const result = await createServerSupabaseClient()
    .from('merchant_payment_accounts')
    .insert({ restaurant_id: input.restaurantId, provider_code: input.providerCode, provider_account_id: input.providerAccountId, status: 'pending' })
    .select(ACCOUNT_COLUMNS)
    .single()
  if (result.error?.code === '23505') {
    const existing = await findForRestaurantByProvider(input.restaurantId, input.providerCode)
    if (existing) return existing
  }
  const account = oneAccount('linkPaymentAccount', result)
  if (!account) throw new Error('linkPaymentAccount: no row')
  return account
}

const RESET = { status: 'pending', charges_enabled: false, details_submitted: false, currency: null, restriction_reason: null, activated_at: null }

/** A disconnected (or id-less) row of this restaurant takes a new provider account; anything else is left alone. */
async function relink(input: { restaurantId: string; accountId: string; providerAccountId: string }) {
  const result = await createServerSupabaseClient()
    .from('merchant_payment_accounts')
    .update({ ...RESET, provider_account_id: input.providerAccountId, updated_at: new Date().toISOString() })
    .eq('id', input.accountId)
    .eq('restaurant_id', input.restaurantId)
    .or('status.eq.disabled,provider_account_id.is.null')
    .select(ACCOUNT_COLUMNS)
    .maybeSingle()
  return oneAccount('relinkPaymentAccount', result)
}

function statusColumns(update: MerchantAccountUpdate, at: Date) {
  const stamp = at.toISOString()
  return {
    status: update.status,
    charges_enabled: update.chargesEnabled,
    details_submitted: update.detailsSubmitted,
    currency: update.currency,
    restriction_reason: update.restrictionReason,
    updated_at: stamp,
    ...(update.status === 'active' ? { activated_at: stamp } : {}),
  }
}

/**
 * W6-fix F6: with `eventAt` (the provider event's time) the write lands only while last_webhook_at is
 * unset or not newer, and stores it; an event older than the last one applied changes nothing (null).
 */
async function applyStatus(input: { accountId: string; providerAccountId: string; update: MerchantAccountUpdate; at: Date; eventAt?: Date }) {
  const eventAt = input.eventAt?.toISOString()
  let query = createServerSupabaseClient()
    .from('merchant_payment_accounts')
    .update({ ...statusColumns(input.update, input.at), ...(eventAt ? { last_webhook_at: eventAt } : {}) })
    .eq('id', input.accountId)
    .eq('provider_account_id', input.providerAccountId)
  if (eventAt) query = query.or(`last_webhook_at.is.null,last_webhook_at.lte.${eventAt}`)
  const result = await query.select(ACCOUNT_COLUMNS).maybeSingle()
  return oneAccount('applyPaymentAccountStatus', result)
}

export const merchantPaymentAccountStore: MerchantPaymentAccountStore = {
  findForRestaurant: (restaurantId) => findPaymentAccountForRestaurant(restaurantId),
  findForRestaurantByProvider,
  findByProviderAccount,
  link,
  relink,
  applyStatus,
}

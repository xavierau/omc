/**
 * BOOK-014: a restaurant's payment provider account (`merchant_payment_accounts`,
 * migration 096). W1 reads it (deposits start only on a chargeable account,
 * spec AC-4); W2's onboarding routes write it. Scoped by restaurant in the
 * query (R58).
 */
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import type { MerchantPaymentAccount } from '@/domain/entities/merchant-payment-account'
import type { MerchantPaymentAccountReader } from '@/domain/ports/booking-deposit'
import { isPaymentProviderCode } from '@/domain/ports/payment-gateway'

const ACCOUNT_COLUMNS = 'id, restaurant_id, provider_code, provider_account_id, status, charges_enabled, currency, restriction_reason, updated_at'

interface AccountRow {
  id: string
  restaurant_id: string
  provider_code: string
  provider_account_id: string | null
  status: MerchantPaymentAccount['status']
  charges_enabled: boolean
  currency: string | null
  restriction_reason: string | null
  updated_at: string
}

function toAccount(row: AccountRow): MerchantPaymentAccount | null {
  // A provider this build has no adapter for is treated as no account (no deposit), never guessed.
  if (!isPaymentProviderCode(row.provider_code)) return null
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    providerCode: row.provider_code,
    providerAccountId: row.provider_account_id,
    status: row.status,
    chargesEnabled: row.charges_enabled,
    currency: row.currency,
    restrictionReason: row.restriction_reason,
  }
}

/** The restaurant's account for deposits: an active one first, else the latest updated. */
export async function findPaymentAccountForRestaurant(restaurantId: string): Promise<MerchantPaymentAccount | null> {
  const { data, error } = await createServerSupabaseClient()
    .from('merchant_payment_accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('restaurant_id', restaurantId)
    .order('updated_at', { ascending: false })
    .limit(10)
  if (error?.code === '22P02') return null
  if (error) throw new Error(`findPaymentAccountForRestaurant: ${error.message}`)
  const accounts = ((data ?? []) as AccountRow[]).map(toAccount).filter((a): a is MerchantPaymentAccount => a !== null)
  return accounts.find((a) => a.status === 'active') ?? accounts[0] ?? null
}

export const merchantPaymentAccountReader: MerchantPaymentAccountReader = {
  findForRestaurant: findPaymentAccountForRestaurant,
}

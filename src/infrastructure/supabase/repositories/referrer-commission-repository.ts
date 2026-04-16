import { createServerSupabaseClient } from '../client'
import type { ReferrerCommission } from '@/domain/entities/referrer-commission'
import {
  type UpsertCommissionInput,
  mapRowToCommission,
  mapCommissionToUpsert,
} from './referrer-commission-mapper'
import {
  type EarningsRow,
  type EarningsRowWithId,
  type ReferrerEarnings,
  aggregateEarnings,
  groupEarningsByReferrer,
} from './referrer-earnings-helpers'
import {
  fetchPaidKeys,
  filterOutPaid,
} from './referrer-commission-upsert-helpers'

export type { ReferrerEarnings } from './referrer-earnings-helpers'

// Re-exported so existing tests can import from the repository.
export { buildKey, filterOutPaid } from './referrer-commission-upsert-helpers'

const COMMISSION_UPSERT_CONFLICT = 'referrer_id,month,tenant_id'
const EARNINGS_COLUMNS =
  'status, total_commission, broadcast_commission, redemption_commission'

export async function upsertCommissions(
  inputs: UpsertCommissionInput[]
): Promise<void> {
  if (inputs.length === 0) return

  const supabase = createServerSupabaseClient()
  const rows = inputs.map(mapCommissionToUpsert)

  const paidKeys = await fetchPaidKeys(supabase, rows)
  const filtered = filterOutPaid(rows, paidKeys)
  if (filtered.length === 0) return

  const { error } = await supabase
    .from('referrer_commissions')
    .upsert(filtered, { onConflict: COMMISSION_UPSERT_CONFLICT })

  if (error) throw new Error(`upsertCommissions: ${error.message}`)
}

export async function listByReferrer(
  referrerId: string,
  month?: string,
  limit = 100
): Promise<ReferrerCommission[]> {
  const supabase = createServerSupabaseClient()

  let query = supabase
    .from('referrer_commissions')
    .select('*')
    .eq('referrer_id', referrerId)

  if (month) query = query.eq('month', month)
  query = query.order('month', { ascending: false }).limit(limit)

  const { data, error } = await query
  if (error) throw new Error(`listByReferrer: ${error.message}`)
  return (data ?? []).map(mapRowToCommission)
}

export async function listByMonth(
  month: string,
  limit = 100
): Promise<ReferrerCommission[]> {
  const supabase = createServerSupabaseClient()

  const { data, error } = await supabase
    .from('referrer_commissions')
    .select('*')
    .eq('month', month)
    .order('tenant_name', { ascending: true })
    .limit(limit)

  if (error) throw new Error(`listByMonth: ${error.message}`)
  return (data ?? []).map(mapRowToCommission)
}

export async function markPaid(id: string): Promise<ReferrerCommission> {
  const supabase = createServerSupabaseClient()

  const { data, error } = await supabase
    .from('referrer_commissions')
    .update({ status: 'paid', paid_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()

  if (error || !data) {
    throw new Error(`markPaid: ${error?.message}`)
  }
  return mapRowToCommission(data)
}

export async function getReferrerEarnings(
  referrerId: string
): Promise<ReferrerEarnings> {
  const supabase = createServerSupabaseClient()

  const { data, error } = await supabase
    .from('referrer_commissions')
    .select(EARNINGS_COLUMNS)
    .eq('referrer_id', referrerId)

  if (error) throw new Error(`getReferrerEarnings: ${error.message}`)
  return aggregateEarnings((data ?? []) as EarningsRow[])
}

export async function listEarningsByReferrer(
  referrerIds: string[]
): Promise<Map<string, ReferrerEarnings>> {
  if (referrerIds.length === 0) return new Map()
  const supabase = createServerSupabaseClient()

  const { data, error } = await supabase
    .from('referrer_commissions')
    .select(`referrer_id, ${EARNINGS_COLUMNS}`)
    .in('referrer_id', referrerIds)

  if (error) throw new Error(`listEarningsByReferrer: ${error.message}`)
  return groupEarningsByReferrer((data ?? []) as EarningsRowWithId[])
}

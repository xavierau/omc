import { createServerSupabaseClient } from '../client'
import type { ReferrerCommission } from '@/domain/entities/referrer-commission'
import {
  type UpsertCommissionInput,
  mapRowToCommission,
  mapCommissionToUpsert,
} from './referrer-commission-mapper'

const COMMISSION_UPSERT_CONFLICT = 'referrer_id,month,tenant_id'

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

export async function markPaid(
  id: string
): Promise<ReferrerCommission> {
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
): Promise<{ total: number; pending: number }> {
  const supabase = createServerSupabaseClient()

  const { data, error } = await supabase
    .rpc('get_referrer_earnings', { p_referrer_id: referrerId })
    .single()

  if (error || !data) {
    throw new Error(`getReferrerEarnings: ${error?.message}`)
  }
  return { total: Number(data.total), pending: Number(data.pending) }
}

// --- exported helpers for testability ---

type Row = Record<string, unknown>

export function buildKey(r: Row): string {
  return `${r.referrer_id}|${r.month}|${r.tenant_id}`
}

export function filterOutPaid(rows: Row[], paidKeys: Set<string>): Row[] {
  return rows.filter((r) => !paidKeys.has(buildKey(r)))
}

async function fetchPaidKeys(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  rows: Row[]
): Promise<Set<string>> {
  const keySet = new Set(rows.map(buildKey))
  const referrerIds = [...new Set(rows.map((r) => r.referrer_id as string))]
  const months = [...new Set(rows.map((r) => r.month as string))]

  const { data, error } = await supabase
    .from('referrer_commissions')
    .select('referrer_id, month, tenant_id')
    .eq('status', 'paid')
    .in('referrer_id', referrerIds)
    .in('month', months)

  if (error) throw new Error(`upsertCommissions: ${error.message}`)

  const paidKeys = new Set<string>()
  for (const row of data ?? []) {
    const key = `${row.referrer_id}|${row.month}|${row.tenant_id}`
    if (keySet.has(key)) paidKeys.add(key)
  }
  return paidKeys
}

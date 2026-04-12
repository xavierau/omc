import { createServerSupabaseClient } from '../client'
import type { ReferrerCommission } from '@/domain/entities/referrer-commission'
import {
  type UpsertCommissionInput,
  mapRowToCommission,
  mapCommissionToUpsert,
} from './referrer-commission-mapper'

export async function upsertCommissions(
  inputs: UpsertCommissionInput[]
): Promise<void> {
  if (inputs.length === 0) return

  const supabase = createServerSupabaseClient()
  const rows = inputs.map(mapCommissionToUpsert)

  const paidIds = await fetchPaidRecordIds(supabase, rows)
  const filtered = filterOutPaid(rows, paidIds)
  if (filtered.length === 0) return

  const { error } = await supabase
    .from('referrer_commissions')
    .upsert(filtered, { onConflict: 'referrer_id,month,tenant_id' })

  if (error) throw new Error(`upsertCommissions: ${error.message}`)
}

export async function listByReferrer(
  referrerId: string,
  month?: string
): Promise<ReferrerCommission[]> {
  const supabase = createServerSupabaseClient()

  let query = supabase
    .from('referrer_commissions')
    .select('*')
    .eq('referrer_id', referrerId)

  if (month) query = query.eq('month', month)
  query = query.order('month', { ascending: false })

  const { data, error } = await query
  if (error) throw new Error(`listByReferrer: ${error.message}`)
  return (data ?? []).map(mapRowToCommission)
}

export async function listByMonth(
  month: string
): Promise<ReferrerCommission[]> {
  const supabase = createServerSupabaseClient()

  const { data, error } = await supabase
    .from('referrer_commissions')
    .select('*')
    .eq('month', month)
    .order('tenant_name', { ascending: true })

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
    .from('referrer_commissions')
    .select('total_commission, status')
    .eq('referrer_id', referrerId)

  if (error) throw new Error(`getReferrerEarnings: ${error.message}`)
  return sumEarnings(data ?? [])
}

// --- helpers ---

function sumEarnings(
  rows: { total_commission: number; status: string }[]
): { total: number; pending: number } {
  let total = 0
  let pending = 0
  for (const row of rows) {
    total += row.total_commission
    if (row.status === 'pending') pending += row.total_commission
  }
  return { total, pending }
}

type Row = Record<string, unknown>

function buildKey(r: Row): string {
  return `${r.referrer_id}|${r.month}|${r.tenant_id}`
}

async function fetchPaidRecordIds(
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

function filterOutPaid(rows: Row[], paidIds: Set<string>): Row[] {
  return rows.filter((r) => !paidIds.has(buildKey(r)))
}

import type { createServerSupabaseClient } from '../client'

export type CommissionKeyRow = Record<string, unknown>

export function buildKey(r: CommissionKeyRow): string {
  return `${r.referrer_id}|${r.month}|${r.tenant_id}`
}

export function filterOutPaid(
  rows: CommissionKeyRow[],
  paidKeys: Set<string>
): CommissionKeyRow[] {
  return rows.filter((r) => !paidKeys.has(buildKey(r)))
}

export async function fetchPaidKeys(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  rows: CommissionKeyRow[]
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

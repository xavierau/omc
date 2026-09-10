import type { createServerSupabaseClient } from '../client'

export type CommissionKeyRow = Record<string, unknown>
type SupabaseClient = ReturnType<typeof createServerSupabaseClient>

const PAID_ROW_CONFLICT_PATTERN = /Cannot modify a paid commission record/i
const COMMISSION_UPSERT_CONFLICT = 'referrer_id,month,tenant_id'

export function buildKey(r: CommissionKeyRow): string {
  return `${r.referrer_id}|${r.month}|${r.tenant_id}`
}

export function filterOutPaid(
  rows: CommissionKeyRow[],
  paidKeys: Set<string>
): CommissionKeyRow[] {
  return rows.filter((r) => !paidKeys.has(buildKey(r)))
}

export function isPaidRowConflictError(
  error: { message?: string } | null | undefined
): boolean {
  const msg = error?.message
  if (typeof msg !== 'string') return false
  return PAID_ROW_CONFLICT_PATTERN.test(msg)
}

export async function fetchPaidKeys(
  supabase: SupabaseClient,
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

export async function upsertFilteringPaid(
  supabase: SupabaseClient,
  rows: CommissionKeyRow[]
): Promise<void> {
  const firstError = await attemptUpsert(supabase, rows)
  if (!firstError) return

  // Race: a concurrent admin may have marked a pending row as paid between
  // fetchPaidKeys() and upsert(). Re-fetch paid keys and retry once.
  if (isPaidRowConflictError(firstError)) {
    const retryError = await attemptUpsert(supabase, rows)
    if (!retryError) return
    throw new Error(`upsertCommissions: ${retryError.message}`)
  }

  throw new Error(`upsertCommissions: ${firstError.message}`)
}

async function attemptUpsert(
  supabase: SupabaseClient,
  rows: CommissionKeyRow[]
): Promise<{ message: string } | null> {
  const paidKeys = await fetchPaidKeys(supabase, rows)
  const filtered = filterOutPaid(rows, paidKeys)
  if (filtered.length === 0) return null

  const { error } = await supabase
    .from('referrer_commissions')
    .upsert(filtered, { onConflict: COMMISSION_UPSERT_CONFLICT })

  return error ?? null
}

// WAQ-012: per-tenant quality KPIs over a sliding window. Reads
// `whatsapp_messages` (category=marketing) plus `consent_records`
// (status=opted_out) and emits totals + derived rates.
//
// Marketing-only by design: that's the surface Meta scores for quality. A
// transactional/utility OTP can have a 0% read rate and still be perfectly
// healthy, so mixing categories would distort the dashboard. Document this
// explicitly here so a future "include all categories" PR has to confront
// the trade-off.
//
// queued_at (not sent_at) is the window boundary so failed-before-send rows
// still count toward error rate. sent_at would silently exclude them.
//
// Aggregation runs server-side via the RPCs in migration 045 to avoid
// PostgREST's default 1000-row cap silently truncating KPIs at scale.
// Each call is a single round-trip with bounded result size.

import { createServerSupabaseClient } from '../client'
import {
  cutoffIso,
  toKpisFromCounters,
  type QualityKpis,
} from './quality-kpi-counters'

export type { QualityKpis } from './quality-kpi-counters'

interface SingleArgs {
  restaurantId: string
  windowDays: number
  now?: Date
}

interface AllArgs {
  windowDays: number
  now?: Date
}

interface KpiRpcRow {
  total_sends: number | string
  delivered: number | string
  read_count: number | string
  failed: number | string
  opted_out: number | string
}

interface KpiRpcRowAll extends KpiRpcRow {
  restaurant_id: string
}

// Postgres BIGINT serializes as a JSON number for values within Number.MAX_SAFE_INTEGER
// (well above any plausible 7-day marketing volume), but PostgREST historically
// returns BIGINT as a string in some configs. Coerce defensively.
function toNum(v: number | string): number {
  return typeof v === 'string' ? Number(v) : v
}

function rowToKpis(row: KpiRpcRow): QualityKpis {
  return toKpisFromCounters({
    totalSends: toNum(row.total_sends),
    delivered: toNum(row.delivered),
    read: toNum(row.read_count),
    failed: toNum(row.failed),
    optedOut: toNum(row.opted_out),
  })
}

export async function getQualityKpisForTenant(
  args: SingleArgs
): Promise<QualityKpis> {
  const cutoff = cutoffIso(args.now, args.windowDays)
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase.rpc('get_quality_kpis_for_tenant', {
    p_restaurant_id: args.restaurantId,
    p_since: cutoff,
  })
  if (error) throw new Error(`getQualityKpisForTenant: ${error.message}`)
  const rows = (data ?? []) as KpiRpcRow[]
  return rows.length === 0
    ? rowToKpis({
        total_sends: 0,
        delivered: 0,
        read_count: 0,
        failed: 0,
        opted_out: 0,
      })
    : rowToKpis(rows[0])
}

export async function getQualityKpisForAllTenants(
  args: AllArgs
): Promise<Map<string, QualityKpis>> {
  const cutoff = cutoffIso(args.now, args.windowDays)
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase.rpc('get_quality_kpis_for_all_tenants', {
    p_since: cutoff,
  })
  if (error) throw new Error(`getQualityKpisForAllTenants: ${error.message}`)
  const rows = (data ?? []) as KpiRpcRowAll[]
  const out = new Map<string, QualityKpis>()
  for (const r of rows) out.set(r.restaurant_id, rowToKpis(r))
  return out
}

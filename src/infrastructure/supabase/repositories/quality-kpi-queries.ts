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

import { createServerSupabaseClient } from '../client'
import {
  cutoffIso,
  emptyCounters,
  tally,
  toKpis,
  type Counters,
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

interface MessageRow {
  status: string
  restaurant_id?: string
}

interface ConsentRow {
  restaurant_id?: string
}

async function fetchTenantMessages(
  restaurantId: string,
  cutoff: string
): Promise<MessageRow[]> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('whatsapp_messages')
    .select('status')
    .eq('restaurant_id', restaurantId)
    .eq('category', 'marketing')
    .gt('queued_at', cutoff)
  if (error) throw new Error(`getQualityKpisForTenant: ${error.message}`)
  return (data ?? []) as MessageRow[]
}

async function fetchTenantOptOuts(
  restaurantId: string,
  cutoff: string
): Promise<number> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('consent_records')
    .select('id')
    .eq('restaurant_id', restaurantId)
    .eq('category', 'marketing')
    .eq('status', 'opted_out')
    .gt('revoked_at', cutoff)
  if (error) throw new Error(`getQualityKpisForTenant: ${error.message}`)
  return (data ?? []).length
}

export async function getQualityKpisForTenant(
  args: SingleArgs
): Promise<QualityKpis> {
  const cutoff = cutoffIso(args.now, args.windowDays)
  const [messages, optedOut] = await Promise.all([
    fetchTenantMessages(args.restaurantId, cutoff),
    fetchTenantOptOuts(args.restaurantId, cutoff),
  ])
  const c = emptyCounters()
  for (const m of messages) tally(c, m.status)
  c.optedOut = optedOut
  return toKpis(c)
}

async function fetchAllMessages(cutoff: string): Promise<MessageRow[]> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('whatsapp_messages')
    .select('restaurant_id, status')
    .eq('category', 'marketing')
    .gt('queued_at', cutoff)
  if (error) throw new Error(`getQualityKpisForAllTenants: ${error.message}`)
  return (data ?? []) as MessageRow[]
}

async function fetchAllOptOuts(cutoff: string): Promise<ConsentRow[]> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('consent_records')
    .select('restaurant_id')
    .eq('category', 'marketing')
    .eq('status', 'opted_out')
    .gt('revoked_at', cutoff)
  if (error) throw new Error(`getQualityKpisForAllTenants: ${error.message}`)
  return (data ?? []) as ConsentRow[]
}

function bucketize(
  messages: MessageRow[],
  consents: ConsentRow[]
): Map<string, Counters> {
  const counters = new Map<string, Counters>()
  for (const m of messages) {
    if (!m.restaurant_id) continue
    const c = counters.get(m.restaurant_id) ?? emptyCounters()
    tally(c, m.status)
    counters.set(m.restaurant_id, c)
  }
  for (const o of consents) {
    if (!o.restaurant_id) continue
    const c = counters.get(o.restaurant_id) ?? emptyCounters()
    c.optedOut += 1
    counters.set(o.restaurant_id, c)
  }
  return counters
}

export async function getQualityKpisForAllTenants(
  args: AllArgs
): Promise<Map<string, QualityKpis>> {
  const cutoff = cutoffIso(args.now, args.windowDays)
  const [messages, consents] = await Promise.all([
    fetchAllMessages(cutoff),
    fetchAllOptOuts(cutoff),
  ])
  const counters = bucketize(messages, consents)
  const out = new Map<string, QualityKpis>()
  for (const [id, c] of counters) out.set(id, toKpis(c))
  return out
}

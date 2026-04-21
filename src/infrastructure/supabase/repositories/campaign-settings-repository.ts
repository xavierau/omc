import { createServerSupabaseClient } from '../client'
import type { TenantCampaignSettings } from '@/domain/services/campaign-guardrails'
import { mapRowToSettings, mapSettingsToUpsert } from './campaign-settings-mapper'

type SettingsUpdate = Partial<Omit<TenantCampaignSettings, 'restaurantId'>>

export async function getSettingsForTenant(
  restaurantId: string
): Promise<TenantCampaignSettings | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('tenant_campaign_settings')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    throw new Error(`getSettingsForTenant: ${error.message}`)
  }
  return data ? mapRowToSettings(data) : null
}

export async function upsertSettings(
  restaurantId: string,
  settings: SettingsUpdate
): Promise<TenantCampaignSettings> {
  const supabase = createServerSupabaseClient()
  const row = mapSettingsToUpsert(restaurantId, settings)

  const { data, error } = await supabase
    .from('tenant_campaign_settings')
    .upsert(row, { onConflict: 'restaurant_id' })
    .select('*')
    .single()

  if (error || !data) {
    throw new Error(`upsertSettings: ${error?.message}`)
  }
  return mapRowToSettings(data)
}

export async function getMonthlyTenantSends(
  restaurantId: string
): Promise<number> {
  const supabase = createServerSupabaseClient()
  const startOfMonth = firstDayOfMonth()

  const { data, error } = await supabase
    .from('campaigns')
    .select('chargeable_sent_count, non_chargeable_sent_count')
    .eq('restaurant_id', restaurantId)
    .gte('created_at', startOfMonth)

  if (error) throw new Error(`getMonthlyTenantSends: ${error.message}`)
  // Guardrails measure TOTAL send volume against the monthly limit —
  // non-chargeable (welcome) sends count toward the limit too so a tenant
  // can't evade the cap by flipping a campaign to non-chargeable.
  return (data ?? []).reduce(
    (sum, r) => sum + (r.chargeable_sent_count ?? 0) + (r.non_chargeable_sent_count ?? 0),
    0
  )
}

export async function getTodayCampaignCount(
  restaurantId: string
): Promise<number> {
  const supabase = createServerSupabaseClient()
  const startOfDay = todayStart()

  const { count, error } = await supabase
    .from('campaigns')
    .select('id', { count: 'exact', head: true })
    .eq('restaurant_id', restaurantId)
    .in('status', ['sending', 'completed'])
    .gte('created_at', startOfDay)

  if (error) throw new Error(`getTodayCampaignCount: ${error.message}`)
  return count ?? 0
}

export async function getUnsubscribeStats(
  restaurantId: string
): Promise<{ total: number; unsubscribed: number }> {
  const supabase = createServerSupabaseClient()

  const { count: total, error: totalErr } = await supabase
    .from('members')
    .select('id', { count: 'exact', head: true })
    .eq('restaurant_id', restaurantId)

  if (totalErr) throw new Error(`getUnsubscribeStats: ${totalErr.message}`)

  const { count: unsubscribed, error: unsubErr } = await supabase
    .from('members')
    .select('id', { count: 'exact', head: true })
    .eq('restaurant_id', restaurantId)
    .eq('status', 'unsubscribed')

  if (unsubErr) throw new Error(`getUnsubscribeStats: ${unsubErr.message}`)

  return { total: total ?? 0, unsubscribed: unsubscribed ?? 0 }
}

function firstDayOfMonth(): string {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
}

function todayStart(): string {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
}

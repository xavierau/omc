import { createServerSupabaseClient } from '../client'
import { mapRowToCampaign } from './campaign-repository'
import { Campaign } from '@/domain/entities/campaign'

export interface TenantUsageRow {
  restaurantId: string
  campaignCount: number
  totalSent: number
}

export async function getCampaignsForTenantMonth(
  restaurantId: string,
  monthStart: string,
  monthEnd: string
): Promise<Campaign[]> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('restaurant_id', restaurantId)
    // 'failed' included: a failed campaign is typically PARTIALLY sent —
    // some members already got the chargeable message before the send
    // exhausted retries (#102 review round 2, item 5a). Dropping it here
    // would silently under-bill.
    .in('status', ['sending', 'completed', 'failed'])
    .gte('created_at', monthStart)
    .lt('created_at', monthEnd)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`getCampaignsForTenantMonth: ${error.message}`)
  return (data ?? []).map(mapRowToCampaign)
}

export async function getAllTenantsUsageForMonth(
  monthStart: string,
  monthEnd: string
): Promise<TenantUsageRow[]> {
  const supabase = createServerSupabaseClient()
  // Only chargeable sends contribute to billing; non-chargeable sends
  // (welcome campaigns) are tracked separately and excluded here.
  const { data, error } = await supabase
    .from('campaigns')
    .select('restaurant_id, chargeable_sent_count')
    // 'failed' included: a failed campaign is typically PARTIALLY sent —
    // some members already got the chargeable message before the send
    // exhausted retries (#102 review round 2, item 5a). Dropping it here
    // would silently under-bill.
    .in('status', ['sending', 'completed', 'failed'])
    .gte('created_at', monthStart)
    .lt('created_at', monthEnd)

  if (error) throw new Error(`getAllTenantsUsageForMonth: ${error.message}`)
  return aggregateByTenant(data ?? [])
}

export function aggregateByTenant(
  rows: Array<{ restaurant_id: string; chargeable_sent_count: number }>
): TenantUsageRow[] {
  const map = new Map<string, TenantUsageRow>()
  for (const row of rows) {
    const existing = map.get(row.restaurant_id)
    if (existing) {
      existing.campaignCount += 1
      existing.totalSent += (row.chargeable_sent_count ?? 0)
    } else {
      map.set(row.restaurant_id, {
        restaurantId: row.restaurant_id,
        campaignCount: 1,
        totalSent: row.chargeable_sent_count ?? 0,
      })
    }
  }
  return Array.from(map.values())
}

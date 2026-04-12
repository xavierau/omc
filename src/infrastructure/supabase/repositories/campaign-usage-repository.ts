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
    .in('status', ['sending', 'completed'])
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
  const { data, error } = await supabase
    .from('campaigns')
    .select('restaurant_id, sent_count')
    .in('status', ['sending', 'completed'])
    .gte('created_at', monthStart)
    .lt('created_at', monthEnd)

  if (error) throw new Error(`getAllTenantsUsageForMonth: ${error.message}`)
  return aggregateByTenant(data ?? [])
}

function aggregateByTenant(
  rows: Array<{ restaurant_id: string; sent_count: number }>
): TenantUsageRow[] {
  const map = new Map<string, TenantUsageRow>()
  for (const row of rows) {
    const existing = map.get(row.restaurant_id)
    if (existing) {
      existing.campaignCount += 1
      existing.totalSent += (row.sent_count ?? 0)
    } else {
      map.set(row.restaurant_id, {
        restaurantId: row.restaurant_id,
        campaignCount: 1,
        totalSent: row.sent_count ?? 0,
      })
    }
  }
  return Array.from(map.values())
}

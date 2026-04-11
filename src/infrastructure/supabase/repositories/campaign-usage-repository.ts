import { createServerSupabaseClient } from '../client'
import { mapRowToCampaign } from './campaign-repository'
import { Campaign } from '@/domain/entities/campaign'

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

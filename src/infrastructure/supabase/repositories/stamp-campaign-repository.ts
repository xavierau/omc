// stamp_campaigns reads for the application layer. findActiveStampCampaign returns
// the single status='active' campaign for a tenant (DB-enforced unique via
// uq_stamp_campaigns_one_active) — the scan/stamp route needs its id + per-day cap.
// 'ended' campaigns are deliberately excluded: during the 14-day honor window no NEW
// stamps are granted, but in-progress cards still complete via the grace path.
import { createServerSupabaseClient } from '../client'

export interface ActiveStampCampaign {
  id: string
  stampsRequired: number
  rewardId: string
  maxStampsPerDay: number
}

export async function findActiveStampCampaign(
  restaurantId: string
): Promise<ActiveStampCampaign | null> {
  const supabase = createServerSupabaseClient()
  const { data } = await supabase
    .from('stamp_campaigns')
    .select('id, stamps_required, reward_id, max_stamps_per_day')
    .eq('restaurant_id', restaurantId)
    .eq('status', 'active')
    .single()

  if (!data) return null
  return {
    id: data.id as string,
    stampsRequired: Number(data.stamps_required),
    rewardId: data.reward_id as string,
    maxStampsPerDay: Number(data.max_stamps_per_day),
  }
}

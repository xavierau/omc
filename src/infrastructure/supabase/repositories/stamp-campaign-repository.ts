// stamp_campaigns reads for the application layer. findActiveStampCampaign returns
// the single status='active' campaign for a tenant (DB-enforced unique via
// uq_stamp_campaigns_one_active) — the scan/stamp route needs its id + per-day cap.
// 'ended' campaigns are deliberately excluded: during the 14-day honor window no NEW
// stamps are granted, but in-progress cards still complete via the grace path.
import { createServerSupabaseClient } from '../client'
import {
  mapRowToStampCampaign,
  type StampCampaignView,
} from './stamp-campaign-mapper'

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

// Owner-dashboard list/get for the stamp-campaign CRUD (plan §9).
export async function listStampCampaigns(
  restaurantId: string
): Promise<StampCampaignView[]> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('stamp_campaigns')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`listStampCampaigns: ${error.message}`)
  return (data ?? []).map(mapRowToStampCampaign)
}

export async function getStampCampaignById(
  id: string,
  restaurantId: string
): Promise<StampCampaignView | null> {
  const supabase = createServerSupabaseClient()
  const { data } = await supabase
    .from('stamp_campaigns')
    .select('*')
    .eq('id', id)
    .eq('restaurant_id', restaurantId)
    .single()
  if (!data) return null
  return mapRowToStampCampaign(data)
}

// Reward-catalog gates for create (plan §9 / Story 1 AC): block creation when the
// restaurant has zero rewards, and validate the chosen reward belongs to the tenant.
export async function countRewards(restaurantId: string): Promise<number> {
  const supabase = createServerSupabaseClient()
  const { count, error } = await supabase
    .from('rewards')
    .select('id', { count: 'exact', head: true })
    .eq('restaurant_id', restaurantId)
  if (error) throw new Error(`countRewards: ${error.message}`)
  return count ?? 0
}

export async function rewardExistsForRestaurant(
  rewardId: string,
  restaurantId: string
): Promise<boolean> {
  const supabase = createServerSupabaseClient()
  const { data } = await supabase
    .from('rewards')
    .select('id')
    .eq('id', rewardId)
    .eq('restaurant_id', restaurantId)
    .single()
  return !!data
}

// Honor-window grace-path resolver lives in its own file (query complexity); re-exported
// here so the stamp-campaign read surface stays cohesive for callers.
export { findStampableCampaignForMember } from './stampable-campaign-repository'

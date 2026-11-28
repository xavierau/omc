// findStampableCampaignForMember (plan §9 honor-window grace path). The scan/stamp
// route resolves which campaign a grant lands on. Normally that is the single ACTIVE
// campaign. But when a campaign is ENDED inside its 14-day honor window, no NEW
// enrollments happen — yet a diner who ALREADY has an in-progress card must still be
// able to add their final stamp(s) and COMPLETE. So this resolver returns:
//   1. the active campaign if one is running, else
//   2. the ended-but-within-honor campaign the member has an in_progress card on.
// apply_stamp itself does not gate on campaign status, so this resolver is the only
// place the grace path must be honored.
import { createServerSupabaseClient } from '../client'
import {
  findActiveStampCampaign,
  type ActiveStampCampaign,
} from './stamp-campaign-repository'

export async function findStampableCampaignForMember(
  restaurantId: string,
  memberId: string
): Promise<ActiveStampCampaign | null> {
  const active = await findActiveStampCampaign(restaurantId)
  if (active) return active
  return findHonorWindowCampaign(restaurantId, memberId)
}

async function findHonorWindowCampaign(
  restaurantId: string,
  memberId: string
): Promise<ActiveStampCampaign | null> {
  const supabase = createServerSupabaseClient()
  const { data } = await supabase
    .from('member_stamp_cards')
    .select(
      'campaign_id, stamp_campaigns!inner(id, stamps_required, reward_id, ' +
        'max_stamps_per_day, status, honor_until)'
    )
    .eq('restaurant_id', restaurantId)
    .eq('member_id', memberId)
    .eq('status', 'in_progress')
    .gt('stamp_campaigns.honor_until', new Date().toISOString())

  const rows = (data ?? []) as unknown as HonorCardRow[]
  const campaign = pickEndedHonorCampaign(rows)
  if (!campaign) return null
  return {
    id: campaign.id,
    stampsRequired: Number(campaign.stamps_required),
    rewardId: campaign.reward_id,
    maxStampsPerDay: Number(campaign.max_stamps_per_day),
  }
}

interface HonorCampaignRow {
  id: string
  stamps_required: number
  reward_id: string
  max_stamps_per_day: number
  status: string
  honor_until: string | null
}

interface HonorCardRow {
  campaign_id: string
  stamp_campaigns: HonorCampaignRow | null
}

function pickEndedHonorCampaign(
  rows: HonorCardRow[]
): HonorCampaignRow | null {
  for (const row of rows) {
    const c = row.stamp_campaigns
    if (c && c.status === 'ended') return c
  }
  return null
}

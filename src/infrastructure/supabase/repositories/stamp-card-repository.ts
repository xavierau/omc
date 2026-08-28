// member_stamp_cards reads/writes for the application layer. The apply_stamp /
// reverse_stamp RPCs own the in-transaction card mutations; these helpers cover
// the application-driven card lifecycle: read the just-completed card (to mint
// off its SNAPSHOTTED reward_id) and open the fresh in_progress card after reset.
import { createServerSupabaseClient } from '../client'

export interface StampCardRecord {
  id: string
  restaurantId: string
  memberId: string
  campaignId: string
  stampsCount: number
  stampsRequired: number
  rewardId: string
  status: 'in_progress' | 'completed'
}

function mapRow(row: Record<string, unknown>): StampCardRecord {
  return {
    id: row.id as string,
    restaurantId: row.restaurant_id as string,
    memberId: row.member_id as string,
    campaignId: row.campaign_id as string,
    stampsCount: Number(row.stamps_count),
    stampsRequired: Number(row.stamps_required),
    rewardId: row.reward_id as string,
    status: row.status as StampCardRecord['status'],
  }
}

export async function getStampCardById(
  cardId: string
): Promise<StampCardRecord | null> {
  const supabase = createServerSupabaseClient()
  const { data } = await supabase
    .from('member_stamp_cards')
    .select('*')
    .eq('id', cardId)
    .single()
  if (!data) return null
  return mapRow(data)
}

export interface OpenNextStampCardParams {
  restaurantId: string
  memberId: string
  campaignId: string
}

/**
 * Open a fresh in_progress card after a completion. Snapshots the CURRENT campaign
 * terms (a later edit cannot move the next card's goalposts mid-flight). Idempotent
 * against the uq_member_stamp_card_inprogress partial unique index: a concurrent
 * open is swallowed so a double-complete never errors the loop.
 */
export async function openNextStampCard(
  params: OpenNextStampCardParams
): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { data: campaign } = await supabase
    .from('stamp_campaigns')
    .select('stamps_required, reward_id')
    .eq('id', params.campaignId)
    .eq('restaurant_id', params.restaurantId)
    .single()
  if (!campaign) throw new Error(`openNextStampCard: campaign not found ${params.campaignId}`)

  const { error } = await supabase.from('member_stamp_cards').insert({
    restaurant_id: params.restaurantId,
    member_id: params.memberId,
    campaign_id: params.campaignId,
    stamps_required: campaign.stamps_required,
    reward_id: campaign.reward_id,
  })
  if (error && !error.message.includes('uq_member_stamp_card_inprogress')) {
    throw new Error(`openNextStampCard: ${error.message}`)
  }
}

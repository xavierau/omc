// Thin wrappers over the apply_stamp / reverse_stamp RPCs (migration 050). The RPCs
// run SECURITY DEFINER under service_role and own all in-transaction card mutation,
// dedup/cap enforcement, and actor capture. These wrappers only translate the
// out_-prefixed composite result rows into the application-layer shape.
import { createServerSupabaseClient } from '../client'

export interface ApplyStampParams {
  restaurantId: string
  memberId: string
  campaignId: string
  actorUserId: string
  maxPerDay: number
}

export interface ApplyStampResult {
  outcome: 'stamped' | 'already_stamped_today'
  stampsCount: number
  stampsRequired: number
  cardId: string
  completed: boolean
}

export async function applyStamp(
  params: ApplyStampParams
): Promise<ApplyStampResult> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase.rpc('apply_stamp', {
    p_restaurant_id: params.restaurantId,
    p_member_id: params.memberId,
    p_campaign_id: params.campaignId,
    p_actor_user_id: params.actorUserId,
    p_max_per_day: params.maxPerDay,
  })
  if (error) throw new Error(`applyStamp: ${error.message}`)

  const row = firstRow(data)
  return {
    outcome: row.out_outcome as ApplyStampResult['outcome'],
    stampsCount: Number(row.out_stamps_count),
    stampsRequired: Number(row.out_stamps_required),
    cardId: row.out_card_id as string,
    completed: Boolean(row.out_completed),
  }
}

export interface ReverseStampParams {
  restaurantId: string
  memberId: string
  campaignId: string
  actorUserId: string
}

export interface ReverseStampResult {
  outcome: 'reversed' | 'at_zero'
  stampsCount: number
  stampsRequired: number
  cardId: string
}

export async function reverseStamp(
  params: ReverseStampParams
): Promise<ReverseStampResult> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase.rpc('reverse_stamp', {
    p_restaurant_id: params.restaurantId,
    p_member_id: params.memberId,
    p_campaign_id: params.campaignId,
    p_actor_user_id: params.actorUserId,
  })
  if (error) throw new Error(`reverseStamp: ${error.message}`)

  const row = firstRow(data)
  return {
    outcome: row.out_outcome as ReverseStampResult['outcome'],
    stampsCount: Number(row.out_stamps_count),
    stampsRequired: Number(row.out_stamps_required),
    cardId: row.out_card_id as string,
  }
}

// Supabase returns SETOF composite rows as an array; both RPCs RETURN QUERY one row.
function firstRow(data: unknown): Record<string, unknown> {
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error('stamp RPC returned no row')
  return row as Record<string, unknown>
}

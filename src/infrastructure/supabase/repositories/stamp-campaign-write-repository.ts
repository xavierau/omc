// stamp_campaigns WRITES for the owner CRUD use cases (plan §9). Create (draft) and
// status transitions (activate/pause/end). The one-active-per-restaurant rule is
// DB-enforced by uq_stamp_campaigns_one_active; a 23505 on activate is surfaced as a
// typed error so the route can return a friendly "Pause the running card first"
// instead of a 500 (mirrors campaign-repository's CampaignUniqueViolationError).
import { createServerSupabaseClient } from '../client'
import type { StampCampaignStatus } from '@/domain/entities/stamp-campaign'
import {
  mapRowToStampCampaign,
  extractConstraintName,
  type StampCampaignView,
} from './stamp-campaign-mapper'

/** Thrown when Postgres rejects a stamp_campaigns write with 23505. */
export class StampCampaignUniqueViolationError extends Error {
  readonly code = '23505'
  constructor(readonly constraint: string | null, message: string) {
    super(message)
    this.name = 'StampCampaignUniqueViolationError'
  }
}

export interface CreateStampCampaignParams {
  restaurantId: string
  name: string
  nameZh?: string | null
  stampsRequired: number
  rewardId: string
  maxStampsPerDay?: number
}

export async function createStampCampaign(
  params: CreateStampCampaignParams
): Promise<StampCampaignView> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('stamp_campaigns')
    .insert({
      restaurant_id: params.restaurantId,
      name: params.name,
      name_zh: params.nameZh ?? null,
      stamps_required: params.stampsRequired,
      reward_id: params.rewardId,
      status: 'draft',
      max_stamps_per_day: params.maxStampsPerDay ?? 1,
    })
    .select('*')
    .single()

  if (error || !data) throw toError('createStampCampaign', error)
  return mapRowToStampCampaign(data)
}

export interface SetStampCampaignStatusParams {
  id: string
  restaurantId: string
  status: StampCampaignStatus
  honorUntil?: string
}

export async function setStampCampaignStatus(
  params: SetStampCampaignStatusParams
): Promise<StampCampaignView> {
  const supabase = createServerSupabaseClient()
  const update: Record<string, unknown> = { status: params.status }
  if (params.honorUntil !== undefined) update.honor_until = params.honorUntil

  const { data, error } = await supabase
    .from('stamp_campaigns')
    .update(update)
    .eq('id', params.id)
    .eq('restaurant_id', params.restaurantId)
    .select('*')
    .single()

  if (error || !data) throw toError('setStampCampaignStatus', error)
  return mapRowToStampCampaign(data)
}

function toError(
  fn: string,
  error: { code?: string; message?: string } | null
): Error {
  if (error?.code === '23505') {
    return new StampCampaignUniqueViolationError(
      extractConstraintName(error),
      error.message ?? 'unique violation'
    )
  }
  return new Error(`${fn}: ${error?.message ?? 'no row returned'}`)
}

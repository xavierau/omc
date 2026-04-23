import { createServerSupabaseClient } from '../client'
import { Campaign } from '@/domain/entities/campaign'
import {
  mapRowToCampaign,
  buildCampaignUpdateRow,
  extractConstraintName,
  type CreateCampaignParams,
  type UpdateCampaignParams,
} from './campaign-mapper'

export type { CreateCampaignParams, UpdateCampaignParams }
export { mapRowToCampaign }

/** Thrown when Postgres rejects a campaigns insert with 23505. */
export class CampaignUniqueViolationError extends Error {
  readonly code = '23505'
  constructor(readonly constraint: string | null, message: string) {
    super(message)
    this.name = 'CampaignUniqueViolationError'
  }
}

export async function createCampaign(
  params: CreateCampaignParams
): Promise<Campaign> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('campaigns')
    .insert({
      restaurant_id: params.restaurantId,
      name: params.name,
      type: params.type,
      template: params.legacyTemplate,
      template_en: params.templateEn ?? null,
      template_zh_hk: params.templateZhHk ?? null,
      coupon_config: params.couponConfig ?? null,
      schedule: params.schedule ?? null,
      scheduled_at: params.scheduledAt ?? null,
      whatsapp_template_id: params.whatsappTemplateId ?? null,
      target_audience: params.targetAudience ?? 'all',
      status: params.status ?? 'draft',
    })
    .select('*')
    .single()

  if (error || !data) {
    if (error?.code === '23505') {
      throw new CampaignUniqueViolationError(
        extractConstraintName(error),
        error.message
      )
    }
    throw new Error(`createCampaign: ${error?.message}`)
  }
  return mapRowToCampaign(data)
}

export async function getCampaignById(
  id: string
): Promise<Campaign | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !data) return null
  return mapRowToCampaign(data)
}

export async function listCampaigns(
  restaurantId: string
): Promise<Campaign[]> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`listCampaigns: ${error.message}`)
  return (data ?? []).map(mapRowToCampaign)
}

export async function updateCampaign(
  id: string,
  changes: UpdateCampaignParams
): Promise<Campaign> {
  const supabase = createServerSupabaseClient()
  const update = buildCampaignUpdateRow(changes)

  const { data, error } = await supabase
    .from('campaigns')
    .update(update)
    .eq('id', id)
    .select('*')
    .single()

  if (error || !data) {
    throw new Error(`updateCampaign: ${error?.message}`)
  }
  return mapRowToCampaign(data)
}

// Counter mutations and the welcome-campaign remap RPC live in
// campaign-counters.ts to keep this file under 150 lines.
export {
  incrementCampaignSent,
  incrementCampaignRedeemed,
  remapWelcomeCampaign,
} from './campaign-counters'

export async function transitionCampaignStatus(
  id: string,
  fromStatus: Campaign['status'],
  toStatus: Campaign['status']
): Promise<boolean> {
  const supabase = createServerSupabaseClient()
  const { data } = await supabase
    .from('campaigns')
    .update({ status: toStatus })
    .eq('id', id)
    .eq('status', fromStatus)
    .select('id')
  return (data?.length ?? 0) > 0
}

export async function getDueCampaigns(): Promise<Campaign[]> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('status', 'active')
    .not('scheduled_at', 'is', null)
    .lte('scheduled_at', new Date().toISOString())

  if (error) throw new Error(`getDueCampaigns: ${error.message}`)
  return (data ?? []).map(mapRowToCampaign)
}

// Campaign-members operations live in campaign-members-repository.ts.
export {
  setCampaignMembers,
  getCampaignMemberIds,
  CrossTenantMemberError,
} from './campaign-members-repository'

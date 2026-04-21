import { createServerSupabaseClient } from '../client'
import { Campaign } from '@/domain/entities/campaign'
import {
  mapRowToCampaign,
  type CreateCampaignParams,
  type UpdateCampaignParams,
} from './campaign-mapper'

export type { CreateCampaignParams, UpdateCampaignParams }
export { mapRowToCampaign }

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
      template: params.template,
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
  const update: Record<string, unknown> = {}

  if (changes.name !== undefined) update.name = changes.name
  if (changes.template !== undefined) update.template = changes.template
  if (changes.couponConfig !== undefined) update.coupon_config = changes.couponConfig
  if (changes.schedule !== undefined) update.schedule = changes.schedule
  if (changes.scheduledAt !== undefined) update.scheduled_at = changes.scheduledAt
  if (changes.whatsappTemplateId !== undefined) update.whatsapp_template_id = changes.whatsappTemplateId
  if (changes.targetAudience !== undefined) update.target_audience = changes.targetAudience
  if (changes.status !== undefined) update.status = changes.status

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

// Counter mutations (chargeable/non-chargeable sent, redeemed, set-chargeable)
// live in campaign-counters.ts to keep this file under 150 lines.
export {
  incrementCampaignSent,
  incrementCampaignRedeemed,
  setCampaignChargeable,
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
} from './campaign-members-repository'

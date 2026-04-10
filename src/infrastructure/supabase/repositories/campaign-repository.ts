import { createServerSupabaseClient } from '../client'
import { Campaign, CouponConfig } from '@/domain/entities/campaign'

export interface CreateCampaignParams {
  restaurantId: string
  name: string
  type: Campaign['type']
  template: string
  couponConfig?: CouponConfig | null
  schedule?: Record<string, unknown> | null
  scheduledAt?: string | null
  whatsappTemplateId?: string | null
  targetAudience?: Campaign['targetAudience']
  status?: Campaign['status']
}

export interface UpdateCampaignParams {
  name?: string
  template?: string
  couponConfig?: CouponConfig | null
  schedule?: Record<string, unknown> | null
  scheduledAt?: string | null
  whatsappTemplateId?: string | null
  targetAudience?: Campaign['targetAudience']
  status?: Campaign['status']
}

function mapRowToCampaign(row: Record<string, unknown>): Campaign {
  return {
    id: row.id as string,
    restaurantId: row.restaurant_id as string,
    name: (row.name as string) ?? null,
    type: row.type as Campaign['type'],
    template: row.template as string,
    couponConfig: (row.coupon_config as CouponConfig) ?? null,
    schedule: (row.schedule as Record<string, unknown>) ?? null,
    scheduledAt: (row.scheduled_at as string) ?? null,
    status: row.status as Campaign['status'],
    sentCount: Number(row.sent_count ?? 0),
    redeemedCount: Number(row.redeemed_count ?? 0),
    whatsappTemplateId: (row.whatsapp_template_id as string) ?? null,
    targetAudience: (row.target_audience as Campaign['targetAudience']) ?? 'all',
    createdAt: row.created_at as string,
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

export async function incrementCampaignSent(
  id: string
): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase.rpc('increment_campaign_sent', {
    campaign_id_param: id,
  })
  if (error) {
    throw new Error(`incrementCampaignSent: ${error.message}`)
  }
}

export async function incrementCampaignRedeemed(
  id: string
): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase.rpc('increment_campaign_redeemed', {
    campaign_id_param: id,
  })
  if (error) {
    throw new Error(`incrementCampaignRedeemed: ${error.message}`)
  }
}

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

export async function setCampaignMembers(
  campaignId: string,
  memberIds: string[]
): Promise<void> {
  const supabase = createServerSupabaseClient()
  // Delete existing members for this campaign
  await supabase.from('campaign_members').delete().eq('campaign_id', campaignId)
  // Insert new members if any
  if (memberIds.length > 0) {
    const rows = memberIds.map((mid) => ({ campaign_id: campaignId, member_id: mid }))
    const { error } = await supabase.from('campaign_members').insert(rows)
    if (error) throw new Error(`setCampaignMembers: ${error.message}`)
  }
}

export async function getCampaignMemberIds(
  campaignId: string
): Promise<string[]> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('campaign_members')
    .select('member_id')
    .eq('campaign_id', campaignId)
  if (error) throw new Error(`getCampaignMemberIds: ${error.message}`)
  return (data ?? []).map((r) => r.member_id as string)
}

// WAQ-011-DETAIL: read-only lookups behind the admin template-review panel.
// Every query is tenant-scoped by restaurant_id (scoped-query authorization,
// SEC-001) — the ids come from a review row, but this client is service-role.

import { createServerSupabaseClient } from '../client'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import type { Campaign, CouponConfig } from '@/domain/entities/campaign'
import { mapRowToTemplate, type WhatsAppTemplateRow } from './whatsapp-template-mapper'

export interface TemplateCampaignRow {
  id: string
  name: string | null
  type: Campaign['type']
  status: Campaign['status']
  targetAudience: Campaign['targetAudience']
  couponConfig: CouponConfig | null
  scheduledAt: string | null
  createdAt: string
}

const CAMPAIGN_COLUMNS =
  'id, name, type, status, target_audience, coupon_config, scheduled_at, created_at'

// Campaigns per template are few; the cap keeps the panel bounded anyway.
const CAMPAIGN_LIMIT = 50

/** Latest non-deleted template with this name (any language) in the restaurant. */
export async function findLatestTemplateByNameForRestaurant(
  restaurantId: string,
  name: string
): Promise<WhatsAppTemplate | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('whatsapp_templates')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('name', name)
    .neq('status', 'deleted')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`findLatestTemplateByNameForRestaurant: ${error.message}`)
  return data ? mapRowToTemplate(data as WhatsAppTemplateRow) : null
}

export async function listCampaignsUsingTemplate(
  restaurantId: string,
  templateId: string
): Promise<TemplateCampaignRow[]> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('campaigns')
    .select(CAMPAIGN_COLUMNS)
    .eq('restaurant_id', restaurantId)
    .eq('whatsapp_template_id', templateId)
    .order('created_at', { ascending: false })
    .limit(CAMPAIGN_LIMIT)
  if (error) throw new Error(`listCampaignsUsingTemplate: ${error.message}`)
  return ((data ?? []) as Record<string, unknown>[]).map(toCampaignRow)
}

/** Head count — never reads the member ids (no max-rows truncation). */
export async function countCampaignMembers(campaignId: string): Promise<number> {
  const supabase = createServerSupabaseClient()
  const { count, error } = await supabase
    .from('campaign_members')
    .select('member_id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
  if (error) throw new Error(`countCampaignMembers: ${error.message}`)
  return count ?? 0
}

function toCampaignRow(row: Record<string, unknown>): TemplateCampaignRow {
  return {
    id: row.id as string,
    name: (row.name as string | null) ?? null,
    type: row.type as Campaign['type'],
    status: row.status as Campaign['status'],
    targetAudience: (row.target_audience as Campaign['targetAudience']) ?? 'all',
    couponConfig: (row.coupon_config as CouponConfig | null) ?? null,
    scheduledAt: (row.scheduled_at as string | null) ?? null,
    createdAt: row.created_at as string,
  }
}

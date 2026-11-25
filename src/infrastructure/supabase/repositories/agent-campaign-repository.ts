/**
 * AGENT-006: the read-only data behind get_recent_campaigns (R2, R3).
 *
 * The diner is the job's own (restaurant + phone in SQL); every later query is
 * scoped by the job restaurant, and the sends also by that member id
 * (memory: principle_authorize_by_scoped_query). Only sends Meta accepted
 * count (sent | delivered | read; memory: principle_sync_ack_is_not_delivery).
 * The window and order use `queued_at` (always set; `sent_at` stays null when
 * a status webhook won the race), which idx_wa_messages_member_queued (080)
 * serves. Only campaign names, send times and template components leave this
 * module: no member id, phone or campaign id reaches the model.
 */
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import type { TemplateComponent } from '@/domain/entities/whatsapp-template'
import type { AgentCampaignSend, AgentConversationKey, AgentRecentCampaignsQuery } from '@/domain/ports/agent-reply'

type Client = ReturnType<typeof createServerSupabaseClient>
type SendRow = { campaign_id: string; template_id: string | null; queued_at: string; sent_at: string | null }
type CampaignRow = { id: string; name: string | null; whatsapp_template_id: string | null }
type TemplateRow = { id: string; components: unknown }
type LatestSend = { campaignId: string; sentAt: string; templateId: string | null }

const ACCEPTED_STATUSES = ['sent', 'delivered', 'read']
/** Rows read per lookup: a campaign leaves 1–2 rows per diner (body, coupon QR), so this covers any 3. */
const SEND_SCAN_LIMIT = 50

const fail = (step: string, error: { code?: string; message?: string }) =>
  new Error(`listAgentRecentCampaigns ${step}: ${error.code ?? error.message ?? 'error'}`)

async function findMemberId(supabase: Client, key: AgentConversationKey): Promise<string | null> {
  const { data, error } = await supabase
    .from('members')
    .select('id')
    .eq('restaurant_id', key.restaurantId)
    .eq('phone', key.phone)
    .maybeSingle()
  if (error) throw fail('member', error)
  return (data as { id: string } | null)?.id ?? null
}

async function acceptedCampaignSends(supabase: Client, restaurantId: string, memberId: string, sinceIso: string) {
  const { data, error } = await supabase
    .from('whatsapp_messages')
    .select('campaign_id, template_id, queued_at, sent_at')
    .eq('restaurant_id', restaurantId)
    .eq('member_id', memberId)
    .eq('direction', 'outbound')
    .not('campaign_id', 'is', null)
    .in('status', ACCEPTED_STATUSES)
    .gte('queued_at', sinceIso)
    .order('queued_at', { ascending: false })
    .limit(SEND_SCAN_LIMIT)
  if (error) throw fail('sends', error)
  return (data ?? []) as SendRow[]
}

/** Rows newest first → one per campaign: its latest send's time, and the newest template id any of its sends carried. */
function latestPerCampaign(rows: readonly SendRow[], limit: number): LatestSend[] {
  const byCampaign = new Map<string, LatestSend>()
  for (const row of rows) {
    const seen = byCampaign.get(row.campaign_id)
    if (seen) seen.templateId ??= row.template_id
    else if (byCampaign.size < limit) {
      byCampaign.set(row.campaign_id, { campaignId: row.campaign_id, sentAt: row.sent_at ?? row.queued_at, templateId: row.template_id })
    }
  }
  return [...byCampaign.values()]
}

async function campaignsById(supabase: Client, restaurantId: string, ids: string[]) {
  const { data, error } = await supabase
    .from('campaigns')
    .select('id, name, whatsapp_template_id')
    .eq('restaurant_id', restaurantId)
    .in('id', ids)
  if (error) throw fail('campaigns', error)
  return new Map(((data ?? []) as CampaignRow[]).map((c) => [c.id, c]))
}

async function templateComponentsById(supabase: Client, restaurantId: string, ids: string[]) {
  if (ids.length === 0) return new Map<string, TemplateComponent[]>()
  const { data, error } = await supabase
    .from('whatsapp_templates')
    .select('id, components')
    .eq('restaurant_id', restaurantId)
    .in('id', ids)
  if (error) throw fail('templates', error)
  return new Map(((data ?? []) as TemplateRow[]).map((t) => [t.id, toComponents(t.components)]))
}

/** The stored JSONB, parsed once here: anything that is not a component object is dropped. */
function toComponents(raw: unknown): TemplateComponent[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (c): c is TemplateComponent => typeof c === 'object' && c !== null && typeof (c as { type?: unknown }).type === 'string'
  )
}

export async function listAgentRecentCampaigns(
  key: AgentConversationKey,
  query: AgentRecentCampaignsQuery
): Promise<AgentCampaignSend[]> {
  const supabase = createServerSupabaseClient()
  const memberId = await findMemberId(supabase, key)
  if (!memberId) return []
  const sends = latestPerCampaign(await acceptedCampaignSends(supabase, key.restaurantId, memberId, query.sinceIso), query.limit)
  if (sends.length === 0) return []
  const campaigns = await campaignsById(supabase, key.restaurantId, sends.map((s) => s.campaignId))
  const found = sends.flatMap((s) => {
    const campaign = campaigns.get(s.campaignId)
    return campaign ? [{ ...s, campaign, templateId: s.templateId ?? campaign.whatsapp_template_id }] : []
  })
  const templateIds = [...new Set(found.flatMap((s) => (s.templateId ? [s.templateId] : [])))]
  const templates = await templateComponentsById(supabase, key.restaurantId, templateIds)
  return found.map((s) => ({
    campaignName: s.campaign.name ?? '',
    sentAt: s.sentAt,
    components: (s.templateId && templates.get(s.templateId)) || [],
  }))
}

/**
 * AGENT-006: the read-only data behind get_recent_campaigns (R2, R3).
 *
 * The diner is the job's own (restaurant + phone in SQL); every later query is
 * scoped by the job restaurant, and the sends also by that member id
 * (memory: principle_authorize_by_scoped_query). Only sends Meta accepted
 * count (sent | delivered | read; memory: principle_sync_ack_is_not_delivery).
 * The window and order use `queued_at` (always set; `sent_at` stays null when
 * a status webhook won the race), which idx_wa_messages_member_queued (080)
 * serves.
 *
 * What the diner saw: the template a send itself carried (never the
 * campaign's current whatsapp_template_id, which may have changed since),
 * flagged when that row was updated after the send (TPL-012 edits in place);
 * a campaign whose sends carried no template sent its inline text, picked in
 * the send's language order (resolvePreferredLanguage, then
 * resolveLocalizedTemplate, as execute-campaign-broadcast does). Only send
 * times and that content leave this module: no member id, phone, campaign id
 * or campaign name reaches the model.
 */
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import type { TemplateComponent } from '@/domain/entities/whatsapp-template'
import type { AgentCampaignContent, AgentCampaignSend, AgentConversationKey, AgentRecentCampaignsQuery } from '@/domain/ports/agent-reply'
import { resolvePreferredLanguage } from '@/domain/services/resolve-preferred-language'
import { resolveLocalizedTemplate } from '@/domain/services/resolve-localized-template'
import type { Language } from '@/domain/value-objects/language'

type Client = ReturnType<typeof createServerSupabaseClient>
type MemberRow = { id: string; preferred_language: string | null }
type SendRow = { campaign_id: string; template_id: string | null; queued_at: string; sent_at: string | null }
type CampaignRow = { id: string; template_zh_hk: string | null; template_en: string | null; template: string | null }
type TemplateRow = { id: string; components: unknown; updated_at: string }
type StoredTemplate = { components: TemplateComponent[]; updatedAt: string }
/** The template a send carried, and when that send was queued. */
type CarriedTemplate = { id: string; queuedAt: string }
type LatestSend = { campaignId: string; sentAt: string; template: CarriedTemplate | null }

const ACCEPTED_STATUSES = ['sent', 'delivered', 'read']
/** Rows read per lookup: a campaign leaves 1–2 rows per diner (body, coupon QR), so this covers any 3. */
const SEND_SCAN_LIMIT = 50

const fail = (step: string, error: { code?: string; message?: string }) =>
  new Error(`listAgentRecentCampaigns ${step}: ${error.code ?? error.message ?? 'error'}`)

async function findMember(supabase: Client, key: AgentConversationKey): Promise<MemberRow | null> {
  const { data, error } = await supabase
    .from('members')
    .select('id, preferred_language')
    .eq('restaurant_id', key.restaurantId)
    .eq('phone', key.phone)
    .maybeSingle()
  if (error) throw fail('member', error)
  return (data as MemberRow | null) ?? null
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

const carried = (row: SendRow): CarriedTemplate | null => (row.template_id ? { id: row.template_id, queuedAt: row.queued_at } : null)

/** Rows newest first → one per campaign: its latest send's time, and the newest template any of its sends carried. */
function latestPerCampaign(rows: readonly SendRow[], limit: number): LatestSend[] {
  const byCampaign = new Map<string, LatestSend>()
  for (const row of rows) {
    const seen = byCampaign.get(row.campaign_id)
    if (seen) seen.template ??= carried(row)
    else if (byCampaign.size < limit) {
      byCampaign.set(row.campaign_id, { campaignId: row.campaign_id, sentAt: row.sent_at ?? row.queued_at, template: carried(row) })
    }
  }
  return [...byCampaign.values()]
}

async function campaignsById(supabase: Client, restaurantId: string, ids: string[]) {
  const { data, error } = await supabase
    .from('campaigns')
    .select('id, template_zh_hk, template_en, template')
    .eq('restaurant_id', restaurantId)
    .in('id', ids)
  if (error) throw fail('campaigns', error)
  return new Map(((data ?? []) as CampaignRow[]).map((c) => [c.id, c]))
}

async function templatesById(supabase: Client, restaurantId: string, ids: string[]) {
  if (ids.length === 0) return new Map<string, StoredTemplate>()
  const { data, error } = await supabase
    .from('whatsapp_templates')
    .select('id, components, updated_at')
    .eq('restaurant_id', restaurantId)
    .in('id', ids)
  if (error) throw fail('templates', error)
  return new Map(((data ?? []) as TemplateRow[]).map((t) => [t.id, { components: toComponents(t.components), updatedAt: t.updated_at }]))
}

/** The stored JSONB, parsed once here: anything that is not a component object is dropped. */
function toComponents(raw: unknown): TemplateComponent[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (c): c is TemplateComponent => typeof c === 'object' && c !== null && typeof (c as { type?: unknown }).type === 'string'
  )
}

async function restaurantDefaultLanguage(supabase: Client, restaurantId: string): Promise<string | null> {
  const { data, error } = await supabase.from('restaurants').select('default_language').eq('id', restaurantId).maybeSingle()
  if (error) throw fail('restaurant', error)
  return (data as { default_language: string | null } | null)?.default_language ?? null
}

/** The send's language: the member's own, else the restaurant default (read only then), else zh_hk. */
async function sendLanguage(supabase: Client, restaurantId: string, member: MemberRow): Promise<Language> {
  const own = member.preferred_language === 'en' || member.preferred_language === 'zh_hk'
  const defaultLanguage = own ? null : await restaurantDefaultLanguage(supabase, restaurantId)
  return resolvePreferredLanguage({ preferredLanguage: member.preferred_language }, { defaultLanguage })
}

function inlineContent(campaign: CampaignRow, preferred: Language): AgentCampaignContent {
  const text = resolveLocalizedTemplate({ en: campaign.template_en, zhHk: campaign.template_zh_hk, legacy: campaign.template, preferred })
  return { kind: 'text', text: text ?? '' }
}

function templateContent(template: CarriedTemplate, stored: StoredTemplate | undefined): AgentCampaignContent {
  const editedAfterSend = stored ? Date.parse(stored.updatedAt) > Date.parse(template.queuedAt) : false
  return { kind: 'template', components: stored?.components ?? [], editedAfterSend }
}

type FoundSend = LatestSend & { campaign: CampaignRow }

async function contentOf(supabase: Client, key: AgentConversationKey, member: MemberRow, found: FoundSend[]) {
  const templateIds = [...new Set(found.flatMap((s) => (s.template ? [s.template.id] : [])))]
  const templates = await templatesById(supabase, key.restaurantId, templateIds)
  let language: Promise<Language> | undefined
  const languageOnce = () => (language ??= sendLanguage(supabase, key.restaurantId, member))
  return Promise.all(
    found.map(async (s): Promise<AgentCampaignSend> => ({
      sentAt: s.sentAt,
      content: s.template ? templateContent(s.template, templates.get(s.template.id)) : inlineContent(s.campaign, await languageOnce()),
    }))
  )
}

export async function listAgentRecentCampaigns(
  key: AgentConversationKey,
  query: AgentRecentCampaignsQuery
): Promise<AgentCampaignSend[]> {
  const supabase = createServerSupabaseClient()
  const member = await findMember(supabase, key)
  if (!member) return []
  const sends = latestPerCampaign(await acceptedCampaignSends(supabase, key.restaurantId, member.id, query.sinceIso), query.limit)
  if (sends.length === 0) return []
  const campaigns = await campaignsById(supabase, key.restaurantId, sends.map((s) => s.campaignId))
  const found = sends.flatMap((s) => {
    const campaign = campaigns.get(s.campaignId)
    return campaign ? [{ ...s, campaign }] : []
  })
  return contentOf(supabase, key, member, found)
}

/**
 * AGENT-006: get_recent_campaigns: the campaigns the job's diner received in
 * the last 30 days (at most 3, newest first), so the agent can answer a reply
 * to a promotion ("How much per person?") from the text the diner saw.
 *
 * Identity comes only from the job key (R2). The text is the stored template:
 * the header text, the body and the URL / phone buttons, placeholders
 * ({{1}}, {{name}}) left as they are. It is restaurant-written data, which the
 * campaigns skill tells the model never to follow as instructions.
 */
import type { TemplateButton, TemplateComponent } from '@/domain/entities/whatsapp-template'
import type { AgentCampaignSend, AgentConversationKey, AgentToolData } from '@/domain/ports/agent-reply'

export const RECENT_CAMPAIGN_DAYS = 30
export const MAX_RECENT_CAMPAIGNS = 3
export const CAMPAIGN_TEXT_MAX_CHARS = 1500

export interface AgentRecentCampaign {
  campaignName: string
  sentAt: string
  templateText: string
}

/** Stored rows may carry the dashboard form's snake_case key. */
type StoredButton = TemplateButton & { phone_number?: string }

function buttonLine(button: StoredButton): string | null {
  const target = button.type === 'URL' ? button.url : button.type === 'PHONE_NUMBER' ? (button.phoneNumber ?? button.phone_number) : null
  return target ? `Button "${button.text ?? ''}": ${target}` : null
}

function componentLines(component: TemplateComponent): string[] {
  if (component.type === 'HEADER') return component.text && (component.format ?? 'TEXT') === 'TEXT' ? [component.text] : []
  if (component.type === 'BODY') return component.text ? [component.text] : []
  if (component.type === 'BUTTONS') return (component.buttons ?? []).flatMap((b) => buttonLine(b) ?? [])
  return []
}

/** Header text, body, then URL / phone buttons, in template order; truncated at CAMPAIGN_TEXT_MAX_CHARS. */
export function campaignTemplateText(components: readonly TemplateComponent[]): string {
  return components.flatMap(componentLines).join('\n').slice(0, CAMPAIGN_TEXT_MAX_CHARS)
}

const toRecent = (send: AgentCampaignSend): AgentRecentCampaign => ({
  campaignName: send.campaignName,
  sentAt: send.sentAt,
  templateText: campaignTemplateText(send.components),
})

export async function getRecentCampaigns(
  key: AgentConversationKey,
  now: Date,
  data: Pick<AgentToolData, 'listRecentCampaigns'>
): Promise<{ campaigns: AgentRecentCampaign[] }> {
  const sinceIso = new Date(now.getTime() - RECENT_CAMPAIGN_DAYS * 86_400_000).toISOString()
  const sends = await data.listRecentCampaigns(key, { sinceIso, limit: MAX_RECENT_CAMPAIGNS })
  return { campaigns: sends.slice(0, MAX_RECENT_CAMPAIGNS).map(toRecent) }
}

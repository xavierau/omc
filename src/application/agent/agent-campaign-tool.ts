/**
 * AGENT-006: get_recent_campaigns: the campaigns the job's diner received in
 * the last 30 days (at most 3, newest first), so the agent can answer a reply
 * to a promotion ("How much per person?") from the text the diner saw.
 *
 * Identity comes only from the job key (R2). The text is the template the send
 * carried (header text, body, URL / phone buttons) or the campaign's own
 * inline text, placeholders ({{1}}, {{name}}) left as they are; a template
 * edited after the send is flagged `editedAfterSend`. It is restaurant-written
 * data, which the campaigns skill tells the model never to follow as
 * instructions. The campaign name is an internal admin label and is not sent.
 */
import type { TemplateButton, TemplateComponent } from '@/domain/entities/whatsapp-template'
import type { AgentCampaignContent, AgentCampaignSend, AgentConversationKey, AgentToolData } from '@/domain/ports/agent-reply'

export const RECENT_CAMPAIGN_DAYS = 30
export const MAX_RECENT_CAMPAIGNS = 3
/** In code points, so an emoji is never split. */
export const CAMPAIGN_TEXT_MAX_CHARS = 1500

export interface AgentRecentCampaign {
  sentAt: string
  templateText: string
  /** The template was modified after this send: the text may not be what the diner received. */
  editedAfterSend: boolean
}

/** Stored rows may carry the dashboard form's snake_case key. */
type StoredButton = TemplateButton & { phone_number?: string }

function buttonLine(button: StoredButton): string | null {
  const label = `Button "${button.text ?? ''}"`
  if (button.type === 'URL' && button.url?.includes('{{')) return `${label}: personal link in the diner's message`
  const target = button.type === 'URL' ? button.url : button.type === 'PHONE_NUMBER' ? (button.phoneNumber ?? button.phone_number) : null
  return target ? `${label}: ${target}` : null
}

function componentLines(component: TemplateComponent): string[] {
  if (component.type === 'HEADER') return component.text && (component.format ?? 'TEXT') === 'TEXT' ? [component.text] : []
  if (component.type === 'BODY') return component.text ? [component.text] : []
  if (component.type === 'BUTTONS') return (component.buttons ?? []).flatMap((b) => buttonLine(b) ?? [])
  return []
}

/** At most CAMPAIGN_TEXT_MAX_CHARS code points: a surrogate pair is never split. */
function truncate(text: string): string {
  return Array.from(text).slice(0, CAMPAIGN_TEXT_MAX_CHARS).join('')
}

/** Header text, body, then URL / phone buttons, in template order; truncated at CAMPAIGN_TEXT_MAX_CHARS. */
export function campaignTemplateText(components: readonly TemplateComponent[]): string {
  return truncate(components.flatMap(componentLines).join('\n'))
}

const contentText = (content: AgentCampaignContent): string =>
  content.kind === 'text' ? truncate(content.text) : campaignTemplateText(content.components)

const toRecent = (send: AgentCampaignSend): AgentRecentCampaign => ({
  sentAt: send.sentAt,
  templateText: contentText(send.content),
  editedAfterSend: send.content.kind === 'template' && send.content.editedAfterSend,
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

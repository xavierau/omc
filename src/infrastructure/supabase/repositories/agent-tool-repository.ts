/**
 * AGENT-001: the read-only data behind the agent's tools (R2, R3).
 *
 * The member lookup is scoped in SQL by BOTH the job's restaurant and phone
 * (memory: principle_authorize_by_scoped_query); the stamp cards by the
 * restaurant and that member. Only loyalty numbers leave this module: no
 * name, no phone, no member id reaches the model.
 */
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { listActiveRewards } from './reward-repository'
import { getContactConfig, getRestaurantRedirect } from './restaurant-repository'
import { buildContactUrl } from '@/domain/services/contact-redirect'
import { listAgentRecentCampaigns } from './agent-campaign-repository'
import type {
  AgentContactAction,
  AgentConversationKey,
  AgentMemberSummary,
  AgentRewardSummary,
  AgentToolData,
} from '@/domain/ports/agent-reply'

type StampCardRow = {
  stamps_count: number
  stamps_required: number
  stamp_campaigns: { name: string | null; name_zh: string | null } | null
}

export async function getAgentMemberSummary(key: AgentConversationKey): Promise<AgentMemberSummary> {
  const supabase = createServerSupabaseClient()
  const { data: member, error } = await supabase
    .from('members')
    .select('id, points_balance')
    .eq('restaurant_id', key.restaurantId)
    .eq('phone', key.phone)
    .maybeSingle()
  if (error) throw new Error(`getAgentMemberSummary: ${error.code ?? 'error'}`)
  if (!member) return { member: false }
  const row = member as { id: string; points_balance: number }

  const { data: cards, error: cardsError } = await supabase
    .from('member_stamp_cards')
    .select('stamps_count, stamps_required, stamp_campaigns(name, name_zh)')
    .eq('restaurant_id', key.restaurantId)
    .eq('member_id', row.id)
    .eq('status', 'in_progress')
  if (cardsError) throw new Error(`getAgentMemberSummary cards: ${cardsError.code ?? 'error'}`)

  return {
    member: true,
    pointsBalance: Number(row.points_balance ?? 0),
    stampCards: ((cards ?? []) as unknown as StampCardRow[]).map((c) => ({
      campaign: c.stamp_campaigns?.name_zh || c.stamp_campaigns?.name || '',
      stamps: Number(c.stamps_count),
      stampsRequired: Number(c.stamps_required),
    })),
  }
}

export async function listAgentRewards(restaurantId: string): Promise<AgentRewardSummary[]> {
  const rewards = await listActiveRewards(restaurantId)
  return rewards.map((r) => ({
    name: r.name,
    pointsCost: r.pointsCost,
    discount: r.discountType === 'percentage' ? `${r.discountValue}% off` : `HK$${r.discountValue} off`,
  }))
}

export async function getAgentContactAction(restaurantId: string): Promise<AgentContactAction> {
  const [{ redirectNumber, redirectLabel }, contact] = await Promise.all([
    getRestaurantRedirect(restaurantId),
    getContactConfig(restaurantId),
  ])
  const url = redirectNumber ? buildContactUrl(redirectNumber) : null
  return { url, label: url ? redirectLabel : null, text: contact.ackText }
}

export const agentToolData: AgentToolData = {
  getMemberSummary: getAgentMemberSummary,
  listRewards: listAgentRewards,
  getContactAction: getAgentContactAction,
  listRecentCampaigns: listAgentRecentCampaigns,
}

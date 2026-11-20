/** AGENT-005: the loyalty half of AGENT-003's rule 6, same instructions. */
import type { AgentToolName } from '@/domain/value-objects/agent-config'
import { offeredOf, offersAnyOf, skillHeader, type AgentSkill } from './agent-skill'

const TOOLS: readonly AgentToolName[] = ['get_member_summary', 'list_rewards']

const USE: Partial<Record<AgentToolName, string>> = {
  get_member_summary: "- For loyalty questions about the diner's own account, use get_member_summary.",
  list_rewards: '- For available rewards, use list_rewards.',
}

export const loyaltySkill: AgentSkill = {
  id: 'loyalty',
  tools: TOOLS,
  enabled: offersAnyOf(TOOLS),
  promptSection: ({ offeredTools }) =>
    [
      skillHeader('LOYALTY'),
      '- You cannot change points, rewards or coupons, so never offer to redeem or change them; say how the diner can do it if the knowledge explains it.',
      ...offeredOf(loyaltySkill, offeredTools).map((t) => USE[t]),
    ].join('\n'),
}

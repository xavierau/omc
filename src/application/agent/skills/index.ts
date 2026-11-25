/** AGENT-005: the reply agent's skills, in prompt order. A new capability is a new skill file added here. */
import type { AgentToolName } from '@/domain/value-objects/agent-config'
import type { AgentSkill } from './agent-skill'
import { coreSkill } from './core-skill'
import { loyaltySkill } from './loyalty-skill'
import { campaignsSkill } from './campaigns-skill'
import { bookingSkill } from './booking-skill'

export type { AgentSkill, AgentSkillId, SkillPromptContext } from './agent-skill'
export { SAFETY_PREAMBLE } from './core-skill'

export const AGENT_SKILLS: readonly AgentSkill[] = [coreSkill, loyaltySkill, campaignsSkill, bookingSkill]

export function activeSkills(offeredTools: readonly AgentToolName[]): AgentSkill[] {
  return AGENT_SKILLS.filter((skill) => skill.enabled(offeredTools))
}

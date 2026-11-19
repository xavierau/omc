/**
 * AGENT-001: the agent's read-only tools (R2, R3).
 *
 * Declarations take NO parameters: the model cannot name a phone, member or
 * restaurant. The executor is bound by the worker to the job's own
 * `{restaurantId, phone}` and ignores every argument the model sends. A call
 * to a tool that is unknown or not in the tenant's `enabledTools` gets an
 * error response and runs nothing. `handoff_to_staff` writes only the
 * agent's own silence row, never loyalty data.
 */
import {
  AGENT_TOOL_NAMES,
  isAgentToolName,
  type AgentToolName,
} from '@/domain/value-objects/agent-config'
import type { AgentToolDeclaration, AgentToolExecutor, AgentToolOutput } from '@/domain/ports/agent-model'
import type { AgentConversationKey, AgentSilenceStore, AgentToolData } from '@/domain/ports/agent-reply'

export const AGENT_TOOL_DECLARATIONS: Record<AgentToolName, AgentToolDeclaration> = {
  get_member_summary: {
    name: 'get_member_summary',
    description:
      "Look up the loyalty membership of the diner you are talking to: points balance and stamp cards in progress, or that they are not a member. Takes no arguments; it always returns the current diner's own data.",
  },
  list_rewards: {
    name: 'list_rewards',
    description: "List the restaurant's active loyalty rewards with their points cost. Takes no arguments.",
  },
  handoff_to_staff: {
    name: 'handoff_to_staff',
    description:
      'Hand the conversation to restaurant staff: use for complaints, allergies, dietary or medical questions, or anything you cannot answer from the knowledge. Returns how the diner can reach staff. Takes no arguments.',
  },
}

export function declarationsFor(enabled: readonly AgentToolName[]): AgentToolDeclaration[] {
  return AGENT_TOOL_NAMES.filter((name) => enabled.includes(name)).map((name) => AGENT_TOOL_DECLARATIONS[name])
}

export interface AgentToolContext {
  /** From the job (signed webhook), never from the model (R2). */
  key: AgentConversationKey
  enabledTools: readonly AgentToolName[]
  handoffSilenceHours: number
  now: () => Date
  data: AgentToolData
  silences: Pick<AgentSilenceStore, 'silenceUntil'>
}

const NOT_AVAILABLE: AgentToolOutput = { error: 'tool_not_available' }

async function runTool(name: AgentToolName, ctx: AgentToolContext): Promise<AgentToolOutput> {
  switch (name) {
    case 'get_member_summary':
      return { ...(await ctx.data.getMemberSummary(ctx.key)) }
    case 'list_rewards':
      return { rewards: await ctx.data.listRewards(ctx.key.restaurantId) }
    case 'handoff_to_staff': {
      const until = new Date(ctx.now().getTime() + ctx.handoffSilenceHours * 3_600_000)
      await ctx.silences.silenceUntil(ctx.key, until.toISOString())
      const contact = await ctx.data.getContactAction(ctx.key.restaurantId)
      return {
        handedOff: true,
        contactUrl: contact.url,
        contactLabel: contact.label,
        staffMessage: contact.text,
        note: 'Tell the diner a staff member will follow up. Share contactUrl if present.',
      }
    }
  }
}

/** The model's args are never read: identity comes only from `ctx.key` (R2). */
export function createAgentToolExecutor(ctx: AgentToolContext): AgentToolExecutor {
  return async (name: string) => {
    if (!isAgentToolName(name) || !ctx.enabledTools.includes(name)) return NOT_AVAILABLE
    try {
      return await runTool(name, ctx)
    } catch {
      return { error: 'lookup_failed' }
    }
  }
}

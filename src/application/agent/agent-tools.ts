/**
 * AGENT-001: the agent's read-only tools (R2, R3).
 *
 * Declarations take NO parameters: the model cannot name a phone, member or
 * restaurant. The executor is bound by the worker to the job's own
 * `{restaurantId, phone}` and ignores every argument the model sends. A call
 * to a tool that is unknown or not in the tenant's `enabledTools` gets an
 * error response and runs nothing. `handoff_to_staff` writes only the
 * agent's own silence row, never loyalty data.
 *
 * AGENT-003: the booking tools (agent-booking-tools.ts) are offered only when
 * enabled AND allowed by the tenant's booking mode; `propose_booking` is the
 * one tool with arguments, none of them an identity (R12).
 */
import {
  AGENT_TOOL_NAMES,
  isAgentToolName,
  type AgentToolName,
} from '@/domain/value-objects/agent-config'
import type { AgentToolDeclaration, AgentToolExecutor, AgentToolOutput } from '@/domain/ports/agent-model'
import type { AgentConversationKey, AgentSilenceStore, AgentToolData } from '@/domain/ports/agent-reply'
import type { BookingMode } from '@/domain/value-objects/booking-config'
import {
  AGENT_BOOKING_TOOL_DECLARATIONS,
  bookingToolsForMode,
  isAgentBookingTool,
  runBookingTool,
  type AgentBookingToolContext,
  type AgentRunMode,
} from './agent-booking-tools'

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
  ...AGENT_BOOKING_TOOL_DECLARATIONS,
}

/**
 * Enabled tools the tenant may use now: a booking tool also needs its booking
 * mode (null = unreadable → none) and, in shadow, not to change or cancel (F2).
 */
export function offeredTools(
  enabled: readonly AgentToolName[],
  bookingMode: BookingMode | null,
  agentMode: AgentRunMode
): AgentToolName[] {
  const allowedBooking = bookingToolsForMode(bookingMode, agentMode)
  return AGENT_TOOL_NAMES.filter(
    (name) => enabled.includes(name) && (!isAgentBookingTool(name) || allowedBooking.includes(name))
  )
}

export function declarationsFor(
  enabled: readonly AgentToolName[],
  bookingMode: BookingMode | null = null,
  agentMode: AgentRunMode = 'auto'
): AgentToolDeclaration[] {
  return offeredTools(enabled, bookingMode, agentMode).map((name) => AGENT_TOOL_DECLARATIONS[name])
}

export interface AgentToolContext {
  /** From the job (signed webhook), never from the model (R2). */
  key: AgentConversationKey
  enabledTools: readonly AgentToolName[]
  /** The run's effective mode: shadow is offered (and runs) no change/cancel tool (F2). */
  agentMode: AgentRunMode
  handoffSilenceHours: number
  now: () => Date
  data: AgentToolData
  silences: Pick<AgentSilenceStore, 'silenceUntil'>
  /** AGENT-003: null when the booking settings could not be read (no booking tool runs). */
  booking: AgentBookingToolContext | null
}

const NOT_AVAILABLE: AgentToolOutput = { error: 'tool_not_available' }

async function runTool(name: AgentToolName, ctx: AgentToolContext, args: Record<string, unknown>): Promise<AgentToolOutput> {
  if (isAgentBookingTool(name)) {
    if (!ctx.booking) return NOT_AVAILABLE
    return runBookingTool(name, { key: ctx.key, now: ctx.now, booking: ctx.booking }, args)
  }
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

/** Identity comes only from `ctx.key` (R2, R12); only propose_booking reads args, and only its booking fields. */
export function createAgentToolExecutor(ctx: AgentToolContext): AgentToolExecutor {
  return async (name: string, args: Record<string, unknown> = {}) => {
    if (!isAgentToolName(name)) return NOT_AVAILABLE
    if (!offeredTools(ctx.enabledTools, ctx.booking?.config.mode ?? null, ctx.agentMode).includes(name)) return NOT_AVAILABLE
    try {
      return await runTool(name, ctx, args)
    } catch {
      return { error: 'lookup_failed' }
    }
  }
}

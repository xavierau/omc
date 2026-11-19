/**
 * AGENT-001: the reply agent's webhook adapter.
 *
 * `maybeQueueAgentReply` runs on the unknown path for text only, after the
 * booking intent router declined. It stores the text and enqueues the agent
 * job; it never calls the model (R1). It returns true when the caller must
 * NOT send today's fallback menu (auto mode queued, a quiet rate-limited
 * phone, or a webhook retry); false keeps today's fallback (mode off,
 * shadow, a silenced phone, a first over-limit message, any error).
 *
 * `agentReplyWorkerHandlers` is the worker's composition: the fallback menu
 * the worker sends on an auto failure is this adapter's `handleUnknown`.
 */
import { admitInboundForAgent, admitSendsFallback, type AgentLogFn } from '@/application/agent/admit-inbound-for-agent'
import { admitAgentDeps, agentWorkerDeps, purgeAgentDeps } from '@/application/agent/agent-deps'
import { processAgentReply } from '@/application/agent/process-agent-reply'
import { purgeAgentMessages } from '@/application/agent/purge-agent-messages'
import type { AgentReplyWorkerHandlers } from '@/infrastructure/queue/agent-reply-queue'
import type { KapsoMessage } from '@/infrastructure/whatsapp/webhooks'
import { handleUnknown } from './unknown-help-handlers'

export interface AgentContext {
  message: KapsoMessage
  restaurantId: string
  phone: string
  log: AgentLogFn
}

export async function maybeQueueAgentReply(ctx: AgentContext): Promise<boolean> {
  if (ctx.message.type !== 'text') return false
  const decision = await admitInboundForAgent(admitAgentDeps(ctx.log), {
    restaurantId: ctx.restaurantId,
    phone: ctx.phone,
    wamid: ctx.message.messageId,
    text: ctx.message.text ?? '',
  })
  return !admitSendsFallback(decision)
}

async function sendFallbackMenu(phoneNumberId: string, phone: string, restaurantId: string): Promise<boolean> {
  const result = await handleUnknown(phoneNumberId, phone, restaurantId)
  return result?.ok !== false
}

export function agentReplyWorkerHandlers(): AgentReplyWorkerHandlers {
  return {
    reply: (job) => processAgentReply(agentWorkerDeps(sendFallbackMenu), job),
    purge: () => purgeAgentMessages(purgeAgentDeps()),
  }
}

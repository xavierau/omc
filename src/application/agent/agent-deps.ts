/**
 * AGENT-001: composition root of the reply agent (as
 * application/booking/inbound-booking-deps.ts). Tests replace it with fakes.
 *
 * The fallback-menu sender is injected by the caller: it lives in the webhook
 * adapter (handleUnknown), which the application layer does not import.
 */
import { getAgentConfig, listAgentTenantConfigs } from '@/infrastructure/supabase/repositories/agent-config-repository'
import { agentMessageStore, agentSilenceStore } from '@/infrastructure/supabase/repositories/agent-message-repository'
import { agentToolData } from '@/infrastructure/supabase/repositories/agent-tool-repository'
import { isWindowOpen } from '@/infrastructure/supabase/repositories/conversation-window-repository'
import { getRestaurantPhoneNumberId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { createGeminiAgentClient } from '@/infrastructure/gemini/agent-client'
import { enqueueAgentReply } from '@/infrastructure/queue/agent-reply-queue'
import { sendTextMessage } from '@/infrastructure/whatsapp/messaging'
import type { AdmitAgentDeps, AgentLogFn } from './admit-inbound-for-agent'
import type { AgentWorkerDeps } from './process-agent-reply'
import type { PurgeAgentDeps } from './purge-agent-messages'

/** Worker log line: event + ids/outcomes only (callers never pass text or phone, R8). */
export const agentConsoleLog: AgentLogFn = (level, event, data) => {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...data })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export function admitAgentDeps(log: AgentLogFn): AdmitAgentDeps {
  return {
    getConfig: getAgentConfig,
    messages: agentMessageStore,
    silences: agentSilenceStore,
    enqueue: enqueueAgentReply,
    now: () => new Date(),
    log,
  }
}

export function agentWorkerDeps(
  sendFallback: AgentWorkerDeps['sendFallback'],
  log: AgentLogFn = agentConsoleLog
): AgentWorkerDeps {
  return {
    getConfig: getAgentConfig,
    messages: agentMessageStore,
    silences: agentSilenceStore,
    toolData: agentToolData,
    model: createGeminiAgentClient(),
    isWindowOpen: (key) => isWindowOpen({ restaurantId: key.restaurantId, phoneE164: key.phone }),
    getPhoneNumberId: async (restaurantId) => (await getRestaurantPhoneNumberId(restaurantId)) || null,
    sendText: sendTextMessage,
    sendFallback,
    now: () => new Date(),
    envModel: process.env.AGENT_MODEL,
    log,
  }
}

export function purgeAgentDeps(log: AgentLogFn = agentConsoleLog): PurgeAgentDeps {
  return {
    listTenantConfigs: listAgentTenantConfigs,
    messages: agentMessageStore,
    silences: agentSilenceStore,
    now: () => new Date(),
    log,
  }
}

/**
 * AGENT-001: composition root of the reply agent (as
 * application/booking/inbound-booking-deps.ts). Tests replace it with fakes.
 *
 * The fallback-menu sender is injected by the caller: it lives in the webhook
 * adapter (handleUnknown), which the application layer does not import.
 */
import { getAgentConfig, listAgentTenantConfigs, readAgentConfig } from '@/infrastructure/supabase/repositories/agent-config-repository'
import { agentMessageStore, agentSilenceStore } from '@/infrastructure/supabase/repositories/agent-message-repository'
import { agentToolData } from '@/infrastructure/supabase/repositories/agent-tool-repository'
import { isWindowOpen } from '@/infrastructure/supabase/repositories/conversation-window-repository'
import { getRestaurantPhoneNumberId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { createGeminiAgentClient } from '@/infrastructure/gemini/agent-client'
import { enqueueAgentReply } from '@/infrastructure/queue/agent-reply-queue'
import { sendTextMessage } from '@/infrastructure/whatsapp/messaging'
import { getAgentProposalStore } from '@/infrastructure/redis/agent-proposal-store'
import { bookingRequestStore, dinerBookingStore } from '@/infrastructure/supabase/repositories/booking-request-repository'
import { bookingSettingsReader } from '@/infrastructure/supabase/repositories/booking-config-repository'
import { agentBookingStore } from '@/infrastructure/supabase/repositories/agent-booking-repository'
import { bookingMessageSender, members } from '@/application/booking/booking-deps'
import { bookingRoomStore } from '@/infrastructure/supabase/repositories/booking-room-repository'
import { bookingDepositStore } from '@/infrastructure/supabase/repositories/booking-deposit-repository'
import { depositChannelPorts, startDepositDeps } from '@/application/payments/payment-deps'
import type { AdmitAgentDeps, AgentLogFn } from './admit-inbound-for-agent'
import type { AgentBookingWorkerDeps, AgentWorkerDeps } from './process-agent-reply'
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

/** AGENT-003: BOOK-001's own stores and sender, the R15 proposal store, the diner's bookings (R20–R24). */
function agentBookingWorkerDeps(): AgentBookingWorkerDeps {
  return {
    getConfig: bookingSettingsReader.getConfig,
    proposals: getAgentProposalStore(),
    requests: bookingRequestStore,
    countLiveUnverified: (restaurantId, now, phone) => agentBookingStore.countLiveUnverified(restaurantId, now, phone),
    members,
    settings: bookingSettingsReader,
    sender: bookingMessageSender(),
    diner: dinerBookingStore,
    // BOOK-010: limits and stops bind the AI tools too (atomic insert, migration 092).
    room: bookingRoomStore,
    // BOOK-014 W5 (spec AC-9): the deposit hold and link on create; deposit bookings are not changed by chat.
    deposit: { ...depositChannelPorts, start: startDepositDeps(), deposits: bookingDepositStore },
    // R24: the diner just wrote, so the service window is open; a closed one is a failed send.
    notifyText: async (restaurantId, phone, text) => {
      const phoneNumberId = await getRestaurantPhoneNumberId(restaurantId)
      if (!phoneNumberId) return false
      return (await sendTextMessage(phoneNumberId, phone, text)).ok
    },
  }
}

export function agentWorkerDeps(
  sendFallback: AgentWorkerDeps['sendFallback'],
  log: AgentLogFn = agentConsoleLog
): AgentWorkerDeps {
  return {
    getConfig: readAgentConfig,
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
    envFallbackModel: process.env.AGENT_FALLBACK_MODEL,
    booking: agentBookingWorkerDeps(),
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

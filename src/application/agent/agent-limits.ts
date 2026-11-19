/**
 * AGENT-001 R6: per-phone hourly and per-tenant daily caps on model calls.
 * Counted from the stored model rows that made a model call (`model` set,
 * whatever the outcome), so the webhook and the worker read the same numbers.
 */
import type { AgentConfig } from '@/domain/value-objects/agent-config'
import type { AgentConversationKey, AgentMessageStore } from '@/domain/ports/agent-reply'

export const HOUR_MS = 3_600_000
export const DAY_MS = 24 * HOUR_MS

export const isoAgo = (now: Date, ms: number) => new Date(now.getTime() - ms).toISOString()

export async function isOverReplyLimit(
  messages: AgentMessageStore,
  key: AgentConversationKey,
  config: Pick<AgentConfig, 'maxRepliesPerPhonePerHour' | 'maxRepliesPerTenantPerDay'>,
  now: Date
): Promise<boolean> {
  const [perPhone, perTenant] = await Promise.all([
    messages.countModelCalls(key.restaurantId, key.phone, isoAgo(now, HOUR_MS)),
    messages.countModelCalls(key.restaurantId, null, isoAgo(now, DAY_MS)),
  ])
  return perPhone >= config.maxRepliesPerPhonePerHour || perTenant >= config.maxRepliesPerTenantPerDay
}

/**
 * Over the limit: record a `rate_limited` row; true when this is the first
 * one for the phone in the last hour (auto sends the fallback menu once,
 * then stays quiet).
 */
export async function recordRateLimited(messages: AgentMessageStore, key: AgentConversationKey, now: Date): Promise<boolean> {
  const alreadyLimited = await messages.hasRateLimitedSince(key, isoAgo(now, HOUR_MS))
  await messages.recordModelRow({
    ...key,
    outcome: 'rate_limited',
    text: null,
    model: null,
    latencyMs: null,
    toolCalls: [],
    replyToMessageId: null,
  })
  return !alreadyLimited
}

/**
 * AGENT-001: storage and data ports of the reply agent.
 *
 * Every method is scoped by restaurant id AND phone taken from the signed
 * webhook / the job, never from model output (R2). The tables are service-role
 * only (RLS on, no client policies: R7).
 */
import type { AgentConfig } from '@/domain/value-objects/agent-config'

export type AgentOutcome = 'shadow_draft' | 'sent' | 'fallback' | 'error' | 'rate_limited' | 'skipped'
export const AGENT_OUTCOMES: readonly AgentOutcome[] = [
  'shadow_draft',
  'sent',
  'fallback',
  'error',
  'rate_limited',
  'skipped',
]

/**
 * Outcomes that answer the diner's message (or would have, in shadow). At most
 * one per inbound user row: migration 083's partial UNIQUE on
 * `reply_to_message_id` makes a second run of the same job a no-op.
 */
export const REPLY_CLAIM_OUTCOMES: readonly AgentOutcome[] = ['sent', 'shadow_draft', 'fallback']

/** Model rows fed back as history: what the diner got (auto) or would have got (shadow). */
export const HISTORY_MODEL_OUTCOMES: readonly AgentOutcome[] = ['sent', 'shadow_draft']

export interface AgentConversationKey {
  restaurantId: string
  phone: string
}

export interface AgentUserMessageInput extends AgentConversationKey {
  text: string
  wamid: string
}

export interface AgentModelRowInput extends AgentConversationKey {
  outcome: AgentOutcome
  text: string | null
  /** Set when the run made a model call: such rows count toward the limits (R6). */
  model: string | null
  latencyMs: number | null
  /** Names only (R9). */
  toolCalls: string[]
  /** The user row this run answers; null for a webhook-side rate_limited row. */
  replyToMessageId: string | null
}

export interface AgentHistoryMessage {
  role: 'user' | 'model'
  text: string
  createdAt: string
}

export type InsertUserMessageResult = { kind: 'inserted'; id: string } | { kind: 'duplicate' }

/** `taken`: another run already stored a REPLY_CLAIM_OUTCOMES row for the same user row. */
export type RecordModelRowResult = { kind: 'inserted'; id: string } | { kind: 'taken' }

/** The worker's config read: a failed read is not mode off (the job may owe the diner a reply). */
export type AgentConfigRead = { ok: true; config: AgentConfig } | { ok: false }

export interface AgentMessageStore {
  insertUserMessage(input: AgentUserMessageInput): Promise<InsertUserMessageResult>
  recordModelRow(input: AgentModelRowInput): Promise<RecordModelRowResult>
  /** Rewrites the outcome of a row this run inserted (a claimed send that failed). */
  setModelOutcome(key: AgentConversationKey, id: string, outcome: AgentOutcome): Promise<void>
  /** Id of the newest user row of the conversation (latest-wins debounce). */
  latestUserMessageId(key: AgentConversationKey): Promise<string | null>
  /** AGENT-003 R15: `created_at` of one of the conversation's user rows; null when it is gone. */
  userMessageCreatedAt(key: AgentConversationKey, id: string): Promise<string | null>
  /** ≤ `limit` rows newer than `sinceIso`, chronological (R5). */
  history(key: AgentConversationKey, limit: number, sinceIso: string): Promise<AgentHistoryMessage[]>
  /** Rows that made a model call (`model` not null, any outcome) since `sinceIso`, for one phone or the whole tenant when `phone` is null (R6). */
  countModelCalls(restaurantId: string, phone: string | null, sinceIso: string): Promise<number>
  /** Whether a `rate_limited` row exists for this phone since `sinceIso` (fallback once, then quiet). */
  hasRateLimitedSince(key: AgentConversationKey, sinceIso: string): Promise<boolean>
  /** Deletes the tenant's rows created before `beforeIso`; returns the count (R5). */
  purgeOlderThan(restaurantId: string, beforeIso: string): Promise<number>
}

export interface AgentSilenceStore {
  isSilenced(key: AgentConversationKey, nowIso: string): Promise<boolean>
  silenceUntil(key: AgentConversationKey, untilIso: string): Promise<void>
  purgeExpired(nowIso: string): Promise<number>
}

export type AgentMemberSummary =
  | { member: false }
  | {
      member: true
      pointsBalance: number
      stampCards: Array<{ campaign: string; stamps: number; stampsRequired: number }>
    }

export interface AgentRewardSummary {
  name: string
  pointsCost: number
  discount: string
}

export interface AgentContactAction {
  /** wa.me link to staff, when the tenant has a valid redirect number. */
  url: string | null
  label: string | null
  /** The tenant's own acknowledgement text, when set. */
  text: string | null
}

/** Read-only data the tools expose (R3). */
export interface AgentToolData {
  getMemberSummary(key: AgentConversationKey): Promise<AgentMemberSummary>
  listRewards(restaurantId: string): Promise<AgentRewardSummary[]>
  getContactAction(restaurantId: string): Promise<AgentContactAction>
}

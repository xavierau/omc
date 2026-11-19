/**
 * AGENT-001: storage and data ports of the reply agent.
 *
 * Every method is scoped by restaurant id AND phone taken from the signed
 * webhook / the job, never from model output (R2). The tables are service-role
 * only (RLS on, no client policies: R7).
 */

export type AgentOutcome = 'shadow_draft' | 'sent' | 'fallback' | 'error' | 'rate_limited' | 'skipped'
export const AGENT_OUTCOMES: readonly AgentOutcome[] = [
  'shadow_draft',
  'sent',
  'fallback',
  'error',
  'rate_limited',
  'skipped',
]

/** Outcomes that cost a model call; counted against the rate limits (R6). */
export const MODEL_CALL_OUTCOMES: readonly AgentOutcome[] = ['shadow_draft', 'sent', 'fallback', 'error']

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
  model: string | null
  latencyMs: number | null
  /** Names only (R9). */
  toolCalls: string[]
}

export interface AgentHistoryMessage {
  role: 'user' | 'model'
  text: string
  createdAt: string
}

export type InsertUserMessageResult = { kind: 'inserted'; id: string } | { kind: 'duplicate' }

export interface AgentMessageStore {
  insertUserMessage(input: AgentUserMessageInput): Promise<InsertUserMessageResult>
  recordModelRow(input: AgentModelRowInput): Promise<void>
  /** Id of the newest user row of the conversation (latest-wins debounce). */
  latestUserMessageId(key: AgentConversationKey): Promise<string | null>
  /** ≤ `limit` rows newer than `sinceIso`, chronological (R5). */
  history(key: AgentConversationKey, limit: number, sinceIso: string): Promise<AgentHistoryMessage[]>
  /** Model-call rows since `sinceIso` for one phone, or the whole tenant when `phone` is null (R6). */
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

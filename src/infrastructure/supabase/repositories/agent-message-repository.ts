/**
 * AGENT-001: `agent_messages` and `agent_silences` (migration 083).
 *
 * Service-role only (RLS on, no client policies: R7). Every query is scoped
 * by restaurant_id, and by phone where it reads one conversation (R2). The
 * partial UNIQUE (restaurant_id, wamid) turns a webhook retry into 23505,
 * reported as `duplicate`. Errors are thrown with the Postgres message only
 * at the caller's boundary; nothing here logs a row (R8).
 */
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import {
  HISTORY_MODEL_OUTCOMES,
  MODEL_CALL_OUTCOMES,
  type AgentConversationKey,
  type AgentHistoryMessage,
  type AgentMessageStore,
  type AgentModelRowInput,
  type AgentSilenceStore,
  type AgentUserMessageInput,
  type InsertUserMessageResult,
} from '@/domain/ports/agent-reply'

// Table names stay literal in `.from('…')`: the schema-contract test parses them.
const UNIQUE_VIOLATION = '23505'

const fail = (what: string, error: { code?: string; message?: string }) =>
  new Error(`${what}: ${error.code ?? 'error'}`)

export async function insertUserMessage(input: AgentUserMessageInput): Promise<InsertUserMessageResult> {
  const { data, error } = await createServerSupabaseClient()
    .from('agent_messages')
    .insert({ restaurant_id: input.restaurantId, phone: input.phone, role: 'user', text: input.text, wamid: input.wamid })
    .select('id')
    .single()
  if (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) return { kind: 'duplicate' }
    throw fail('insertUserMessage', error)
  }
  return { kind: 'inserted', id: (data as { id: string }).id }
}

export async function recordModelRow(input: AgentModelRowInput): Promise<void> {
  const { error } = await createServerSupabaseClient().from('agent_messages').insert({
    restaurant_id: input.restaurantId,
    phone: input.phone,
    role: 'model',
    text: input.text,
    outcome: input.outcome,
    model: input.model,
    latency_ms: input.latencyMs,
    tool_calls: input.toolCalls,
  })
  if (error) throw fail('recordModelRow', error)
}

export async function latestUserMessageId(key: AgentConversationKey): Promise<string | null> {
  const { data, error } = await createServerSupabaseClient()
    .from('agent_messages')
    .select('id')
    .eq('restaurant_id', key.restaurantId)
    .eq('phone', key.phone)
    .eq('role', 'user')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw fail('latestUserMessageId', error)
  return (data as { id: string } | null)?.id ?? null
}

/** Newest `limit` rows inside the TTL (user rows + replies the diner got or would have got), oldest first. */
export async function history(key: AgentConversationKey, limit: number, sinceIso: string): Promise<AgentHistoryMessage[]> {
  const { data, error } = await createServerSupabaseClient()
    .from('agent_messages')
    .select('role, text, created_at')
    .eq('restaurant_id', key.restaurantId)
    .eq('phone', key.phone)
    .gte('created_at', sinceIso)
    .or(`role.eq.user,outcome.in.(${HISTORY_MODEL_OUTCOMES.join(',')})`)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw fail('history', error)
  return ((data ?? []) as Array<{ role: 'user' | 'model'; text: string | null; created_at: string }>)
    .filter((row) => typeof row.text === 'string' && row.text.length > 0)
    .map((row) => ({ role: row.role, text: row.text as string, createdAt: row.created_at }))
    .reverse()
}

export async function countModelCalls(restaurantId: string, phone: string | null, sinceIso: string): Promise<number> {
  let query = createServerSupabaseClient()
    .from('agent_messages')
    .select('id', { count: 'exact', head: true })
    .eq('restaurant_id', restaurantId)
  if (phone !== null) query = query.eq('phone', phone)
  const { count, error } = await query.in('outcome', [...MODEL_CALL_OUTCOMES]).gte('created_at', sinceIso)
  if (error) throw fail('countModelCalls', error)
  return count ?? 0
}

export async function hasRateLimitedSince(key: AgentConversationKey, sinceIso: string): Promise<boolean> {
  const { count, error } = await createServerSupabaseClient()
    .from('agent_messages')
    .select('id', { count: 'exact', head: true })
    .eq('restaurant_id', key.restaurantId)
    .eq('phone', key.phone)
    .eq('outcome', 'rate_limited')
    .gte('created_at', sinceIso)
  if (error) throw fail('hasRateLimitedSince', error)
  return (count ?? 0) > 0
}

export async function purgeOlderThan(restaurantId: string, beforeIso: string): Promise<number> {
  const { count, error } = await createServerSupabaseClient()
    .from('agent_messages')
    .delete({ count: 'exact' })
    .eq('restaurant_id', restaurantId)
    .lt('created_at', beforeIso)
  if (error) throw fail('purgeOlderThan', error)
  return count ?? 0
}

export const agentMessageStore: AgentMessageStore = {
  insertUserMessage,
  recordModelRow,
  latestUserMessageId,
  history,
  countModelCalls,
  hasRateLimitedSince,
  purgeOlderThan,
}

export async function isSilenced(key: AgentConversationKey, nowIso: string): Promise<boolean> {
  const { data, error } = await createServerSupabaseClient()
    .from('agent_silences')
    .select('silenced_until')
    .eq('restaurant_id', key.restaurantId)
    .eq('phone', key.phone)
    .gt('silenced_until', nowIso)
    .maybeSingle()
  if (error) throw fail('isSilenced', error)
  return data !== null
}

export async function silenceUntil(key: AgentConversationKey, untilIso: string): Promise<void> {
  const { error } = await createServerSupabaseClient()
    .from('agent_silences')
    .upsert(
      { restaurant_id: key.restaurantId, phone: key.phone, silenced_until: untilIso },
      { onConflict: 'restaurant_id,phone' }
    )
  if (error) throw fail('silenceUntil', error)
}

export async function purgeExpiredSilences(nowIso: string): Promise<number> {
  const { count, error } = await createServerSupabaseClient()
    .from('agent_silences')
    .delete({ count: 'exact' })
    .lt('silenced_until', nowIso)
  if (error) throw fail('purgeExpiredSilences', error)
  return count ?? 0
}

export const agentSilenceStore: AgentSilenceStore = {
  isSilenced,
  silenceUntil,
  purgeExpired: purgeExpiredSilences,
}

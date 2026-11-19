/**
 * AGENT-001 W2: reads for the dashboard conversation log (R7).
 *
 * `agent_messages` is service-role only (RLS on, no policies), so these
 * queries are the only guard: every one filters `restaurant_id` in SQL
 * (memory: principle_authorize_by_scoped_query), never fetch-then-compare.
 * The thread list selects no text; a thread is resolved from its key (a row
 * id) inside the tenant only.
 */
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import type { AgentOutcome } from '@/domain/ports/agent-reply'
import type { AgentLogRow, AgentThreadMessage } from '@/domain/services/agent-conversation-log'

// Table names stay literal in `.from('…')`: the schema-contract test parses them.
const fail = (what: string, error: { code?: string }) => new Error(`${what}: ${error.code ?? 'error'}`)

/** The tenant's rows since `sinceIso`, newest first, at most `limit`. */
export async function listAgentLogRowsForRestaurant(restaurantId: string, sinceIso: string, limit: number): Promise<AgentLogRow[]> {
  const { data, error } = await createServerSupabaseClient()
    .from('agent_messages')
    .select('id, phone, role, outcome, created_at')
    .eq('restaurant_id', restaurantId)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw fail('listAgentLogRows', error)
  return ((data ?? []) as Array<{ id: string; phone: string; role: 'user' | 'model'; outcome: AgentOutcome | null; created_at: string }>).map(
    (row) => ({ id: row.id, phone: row.phone, role: row.role, outcome: row.outcome, createdAt: row.created_at })
  )
}

/** The phone of thread `key`, only when that row belongs to `restaurantId`. */
export async function findAgentThreadPhoneForRestaurant(restaurantId: string, key: string): Promise<string | null> {
  const { data, error } = await createServerSupabaseClient()
    .from('agent_messages')
    .select('phone')
    .eq('id', key)
    .eq('restaurant_id', restaurantId)
    .maybeSingle()
  if (error) throw fail('findAgentThreadPhone', error)
  return (data as { phone: string } | null)?.phone ?? null
}

/** The newest `limit` rows of one conversation in the tenant, oldest first. */
export async function listAgentThreadMessagesForRestaurant(
  restaurantId: string,
  phone: string,
  limit: number
): Promise<AgentThreadMessage[]> {
  const { data, error } = await createServerSupabaseClient()
    .from('agent_messages')
    .select('id, role, text, outcome, model, latency_ms, tool_calls, created_at')
    .eq('restaurant_id', restaurantId)
    .eq('phone', phone)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw fail('listAgentThreadMessages', error)
  type Row = {
    id: string
    role: 'user' | 'model'
    text: string | null
    outcome: AgentOutcome | null
    model: string | null
    latency_ms: number | null
    tool_calls: string[] | null
    created_at: string
  }
  return ((data ?? []) as Row[])
    .map((row) => ({
      id: row.id,
      role: row.role,
      text: row.text,
      outcome: row.outcome,
      model: row.model,
      latencyMs: row.latency_ms,
      toolCalls: row.tool_calls ?? [],
      createdAt: row.created_at,
    }))
    .reverse()
}

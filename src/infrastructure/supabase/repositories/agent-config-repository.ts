/**
 * AGENT-001: `restaurants.agent_config` (migration 083).
 *
 * Its own getter, never part of `RESTAURANT_COLUMNS`, so the webhook hot path
 * is not coupled to migration 083 (memory:
 * principle_shared_select_migration_coupling). `getAgentConfig` (webhook)
 * never throws: any error resolves to the defaults, i.e. mode off (today's
 * behaviour). `readAgentConfig` (worker) reports a failed read as such: the
 * job may have suppressed the diner's fallback menu and still owes a reply.
 *
 * Writes are a compare-and-swap on `agent_config.rev`, as
 * booking-config-repository.ts: read the raw value, apply the change, write
 * with rev + 1 only while the stored rev is still the one read.
 */
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { resolveAgentConfig, type AgentConfig } from '@/domain/value-objects/agent-config'
import type { AgentConfigRead } from '@/domain/ports/agent-reply'

/** A missing restaurant row reads as the defaults (mode off); only a query error is `ok: false`. */
export async function readAgentConfig(restaurantId: string): Promise<AgentConfigRead> {
  try {
    const { data, error } = await createServerSupabaseClient()
      .from('restaurants')
      .select('agent_config')
      .eq('id', restaurantId)
      .maybeSingle()
    if (error) return { ok: false }
    return { ok: true, config: resolveAgentConfig((data as { agent_config?: unknown } | null)?.agent_config) }
  } catch {
    return { ok: false }
  }
}

export async function getAgentConfig(restaurantId: string): Promise<AgentConfig> {
  const read = await readAgentConfig(restaurantId)
  return read.ok ? read.config : resolveAgentConfig(undefined)
}

/** Every tenant's resolved config, for the retention purge (R5). Throws on a read error. */
export async function listAgentTenantConfigs(): Promise<Array<{ restaurantId: string; config: AgentConfig }>> {
  const { data, error } = await createServerSupabaseClient().from('restaurants').select('id, agent_config')
  if (error) throw new Error(`Failed to list agent configs: ${error.message}`)
  return ((data ?? []) as Array<{ id: string; agent_config?: unknown }>).map((row) => ({
    restaurantId: row.id,
    config: resolveAgentConfig(row.agent_config),
  }))
}

async function readRaw(restaurantId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await createServerSupabaseClient()
    .from('restaurants')
    .select('agent_config')
    .eq('id', restaurantId)
    .maybeSingle()
  if (error) throw new Error(`Failed to read agent config: ${error.message}`)
  const raw = (data as { agent_config?: unknown } | null)?.agent_config
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
}

async function writeIfUnchanged(restaurantId: string, rev: unknown, next: AgentConfig): Promise<boolean> {
  const stamped = { ...next, rev: Number.isInteger(rev) ? (rev as number) + 1 : 1 }
  const query = createServerSupabaseClient().from('restaurants').update({ agent_config: stamped }).eq('id', restaurantId)
  const guarded =
    rev === undefined || rev === null ? query.is('agent_config->>rev', null) : query.eq('agent_config->>rev', String(rev))
  const { data, error } = await guarded.select('id')
  if (error) throw new Error(`Failed to update agent config: ${error.message}`)
  return Array.isArray(data) && data.length > 0
}

/** The stored revision; a config written before revisions existed is rev 0. */
const revOf = (raw: Record<string, unknown> | null): number => (Number.isInteger(raw?.rev) ? (raw?.rev as number) : 0)

/** W2 settings GET: the resolved config and its rev. Throws on a read error (a form primed with defaults could save them back). */
export async function getAgentSettings(restaurantId: string): Promise<{ config: AgentConfig; rev: number }> {
  const raw = await readRaw(restaurantId)
  return { config: resolveAgentConfig(raw ?? undefined), rev: revOf(raw) }
}

export type SaveAgentSettingsResult = { kind: 'saved'; config: AgentConfig; rev: number } | { kind: 'stale'; rev: number }

/**
 * W2 settings PUT: writes only while the stored rev is still the one the admin
 * loaded (`expectedRev`); otherwise `stale` with the stored rev, nothing written.
 * It never retries: a retry would apply a form that was filled in against an
 * older config. This is the only write path.
 */
export async function saveAgentSettingsAtRev(
  restaurantId: string,
  expectedRev: number,
  change: (current: AgentConfig) => AgentConfig
): Promise<SaveAgentSettingsResult> {
  const raw = await readRaw(restaurantId)
  const rev = revOf(raw)
  if (rev !== expectedRev) return { kind: 'stale', rev }
  const next = change(resolveAgentConfig(raw ?? undefined))
  if (await writeIfUnchanged(restaurantId, raw?.rev, next)) return { kind: 'saved', config: next, rev: rev + 1 }
  return { kind: 'stale', rev: revOf(await readRaw(restaurantId)) }
}

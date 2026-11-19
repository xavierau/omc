/**
 * AGENT-001 R5 (PDPO DPP2): hourly retention purge. Each tenant's agent rows
 * older than ITS `historyTtlHours` are deleted, whatever its mode now (a
 * tenant switched back to off still has rows to purge), and expired handoff
 * silences go with them. One tenant's failure does not stop the others.
 */
import type { AgentConfig } from '@/domain/value-objects/agent-config'
import type { AgentMessageStore, AgentSilenceStore } from '@/domain/ports/agent-reply'
import { HOUR_MS, isoAgo } from './agent-limits'
import type { AgentLogFn } from './admit-inbound-for-agent'

export interface PurgeAgentDeps {
  listTenantConfigs(): Promise<Array<{ restaurantId: string; config: AgentConfig }>>
  messages: Pick<AgentMessageStore, 'purgeOlderThan'>
  silences: Pick<AgentSilenceStore, 'purgeExpired'>
  now(): Date
  log: AgentLogFn
}

export async function purgeAgentMessages(deps: PurgeAgentDeps): Promise<{ deleted: number; failedTenants: number }> {
  const now = deps.now()
  let deleted = 0
  let failedTenants = 0
  for (const { restaurantId, config } of await deps.listTenantConfigs()) {
    try {
      deleted += await deps.messages.purgeOlderThan(restaurantId, isoAgo(now, config.historyTtlHours * HOUR_MS))
    } catch {
      failedTenants++
      deps.log('warn', 'agent.purge_failed', { restaurantId })
    }
  }
  const silences = await deps.silences.purgeExpired(now.toISOString())
  deps.log('info', 'agent.purged', { deleted, silences, failedTenants })
  return { deleted, failedTenants }
}

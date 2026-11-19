// AGENT-001 W1: retention purge (AC-R5, PDPO DPP2).
import { describe, it, expect } from 'vitest'
import { purgeAgentMessages } from '@/application/agent/purge-agent-messages'
import { resolveAgentConfig } from '@/domain/value-objects/agent-config'
import { FakeAgentStore, FakeClock } from './agent-fakes'

const NOW = '2026-11-19T10:00:00.000Z'

function setup() {
  const clock = new FakeClock(Date.parse(NOW))
  const store = new FakeAgentStore(clock)
  const logs: Array<{ event: string; data: Record<string, unknown> }> = []
  const at = (iso: string) => ({ created_at: iso })
  return { clock, store, logs, at, log: (_l: string, event: string, data: Record<string, unknown>) => logs.push({ event, data }) }
}

describe('AC-R5 retention purge', () => {
  it('AC-R5 rows older than each tenant’s TTL are deleted, younger rows kept', async () => {
    const { clock, store, log, at } = setup()
    // rest-a: default 72 h; rest-b: 24 h; rest-c: off now, still purged at 72 h.
    store.seed({ restaurant_id: 'rest-a', phone: 'p', role: 'user', text: 'a-old', ...at('2026-11-16T09:59:00.000Z') })
    store.seed({ restaurant_id: 'rest-a', phone: 'p', role: 'user', text: 'a-young', ...at('2026-11-16T10:01:00.000Z') })
    store.seed({ restaurant_id: 'rest-b', phone: 'p', role: 'model', outcome: 'sent', text: 'b-old', ...at('2026-11-18T09:00:00.000Z') })
    store.seed({ restaurant_id: 'rest-b', phone: 'p', role: 'user', text: 'b-young', ...at('2026-11-18T11:00:00.000Z') })
    store.seed({ restaurant_id: 'rest-c', phone: 'p', role: 'user', text: 'c-old', ...at('2026-11-10T00:00:00.000Z') })
    await store.silenceUntil({ restaurantId: 'rest-a', phone: 'p' }, '2026-11-19T09:00:00.000Z')
    await store.silenceUntil({ restaurantId: 'rest-a', phone: 'q' }, '2026-11-19T20:00:00.000Z')

    const result = await purgeAgentMessages({
      listTenantConfigs: async () => [
        { restaurantId: 'rest-a', config: resolveAgentConfig({ mode: 'auto' }) },
        { restaurantId: 'rest-b', config: resolveAgentConfig({ mode: 'shadow', historyTtlHours: 24 }) },
        { restaurantId: 'rest-c', config: resolveAgentConfig({ mode: 'off' }) },
      ],
      messages: store,
      silences: store,
      now: clock.now,
      log,
    })

    expect(store.rows.map((r) => r.text).sort()).toEqual(['a-young', 'b-young'])
    expect(result).toEqual({ deleted: 3, failedTenants: 0 })
    expect([...store.silences.keys()]).toEqual(['rest-a|q'])
  })

  it('AC-R5 one tenant failing does not stop the others; logs carry no text', async () => {
    const { clock, store, logs, log, at } = setup()
    store.seed({ restaurant_id: 'rest-b', phone: 'p', role: 'user', text: 'secret old text', ...at('2026-11-01T00:00:00.000Z') })
    const result = await purgeAgentMessages({
      listTenantConfigs: async () => [
        { restaurantId: 'rest-a', config: resolveAgentConfig({}) },
        { restaurantId: 'rest-b', config: resolveAgentConfig({}) },
      ],
      messages: {
        purgeOlderThan: async (id, before) => {
          if (id === 'rest-a') throw new Error('timeout')
          return store.purgeOlderThan(id, before)
        },
      },
      silences: store,
      now: clock.now,
      log,
    })
    expect(result).toEqual({ deleted: 1, failedTenants: 1 })
    expect(JSON.stringify(logs)).not.toContain('secret')
  })
})

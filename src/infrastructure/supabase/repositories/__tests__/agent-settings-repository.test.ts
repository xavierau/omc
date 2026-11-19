// AGENT-001 W2 AC-W2-API: the settings CAS on agent_config.rev (query shape;
// the jsonb ->> rev guard on agent_config).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { recordingSupabase, filtersOf } from '@/test-utils/recording-supabase'

vi.mock('@/infrastructure/supabase/client', () => ({ createServerSupabaseClient: vi.fn() }))

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { getAgentSettings, saveAgentSettingsAtRev } from '../agent-config-repository'
import { DEFAULT_AGENT_CONFIG } from '@/domain/value-objects/agent-config'

function use(results: Parameters<typeof recordingSupabase>[0]) {
  const rec = recordingSupabase(results)
  vi.mocked(createServerSupabaseClient).mockReturnValue(rec.client as never)
  return rec
}

const toAuto = (c: typeof DEFAULT_AGENT_CONFIG) => ({ ...c, mode: 'auto' as const })

beforeEach(() => vi.clearAllMocks())

describe('AC-W2-API agent settings repository', () => {
  it('AC-W2-API GET reads the tenant row; a config without rev is rev 0', async () => {
    const rec = use([{ data: { agent_config: { mode: 'shadow' } } }])
    expect(await getAgentSettings('rest-a')).toEqual({ config: { ...DEFAULT_AGENT_CONFIG, mode: 'shadow' }, rev: 0 })
    expect(filtersOf(rec.queries[0])).toEqual(['eq:id=rest-a'])
  })

  it('AC-W2-API GET throws on a read error (no defaults a save could write back)', async () => {
    use([{ error: { message: 'down' } }])
    await expect(getAgentSettings('rest-a')).rejects.toThrow('Failed to read agent config')
  })

  it('AC-W2-API save at the stored rev writes rev + 1, guarded on the stored rev', async () => {
    const rec = use([{ data: { agent_config: { mode: 'shadow', rev: 4 } } }, { data: [{ id: 'rest-a' }] }])
    const result = await saveAgentSettingsAtRev('rest-a', 4, toAuto)
    expect(result).toEqual({ kind: 'saved', config: { ...DEFAULT_AGENT_CONFIG, mode: 'auto' }, rev: 5 })
    const update = rec.queries[1]
    expect(update.calls.find(([m]) => m === 'update')?.[1]).toEqual({ agent_config: { ...DEFAULT_AGENT_CONFIG, mode: 'auto', rev: 5 } })
    expect(filtersOf(update)).toEqual(['eq:id=rest-a', 'eq:agent_config->>rev=4'])
  })

  it('AC-W2-API save with a stale rev → stale with the stored rev, no write', async () => {
    const rec = use([{ data: { agent_config: { mode: 'shadow', rev: 4 } } }])
    expect(await saveAgentSettingsAtRev('rest-a', 3, toAuto)).toEqual({ kind: 'stale', rev: 4 })
    expect(rec.queries).toHaveLength(1)
  })

  it('AC-W2-API a race lost between read and write → stale with the new rev, no retry', async () => {
    const rec = use([
      { data: { agent_config: { mode: 'shadow', rev: 4 } } },
      { data: [] },
      { data: { agent_config: { mode: 'off', rev: 5 } } },
    ])
    expect(await saveAgentSettingsAtRev('rest-a', 4, toAuto)).toEqual({ kind: 'stale', rev: 5 })
    expect(rec.queries).toHaveLength(3)
  })

  it('AC-W2-API first save of a never-revised config (rev 0) is guarded on rev IS NULL', async () => {
    const rec = use([{ data: { agent_config: { mode: 'off' } } }, { data: [{ id: 'rest-a' }] }])
    expect((await saveAgentSettingsAtRev('rest-a', 0, toAuto)).kind).toBe('saved')
    expect(filtersOf(rec.queries[1])).toEqual(['eq:id=rest-a', 'is:agent_config->>rev=null'])
  })
})

// AGENT-001 W1 (AC-MIG): every column an agent repository selects, inserts,
// updates or filters on exists in the migrations SQL, and migration 083
// enables RLS with no client policies (memory:
// incident_int001_fakes_hid_schema_mismatch). Mocked clients accept any
// column string; this test does not.
import path from 'node:path'
import fs from 'node:fs'
import { describe, it, expect } from 'vitest'
import { columnsForTable } from './schema-contract/parse-schema'
import { repositoryColumnsByTable } from './schema-contract/parse-repository-columns'
import { AGENT_OUTCOMES } from '@/domain/ports/agent-reply'

const REPOS_DIR = path.join(process.cwd(), 'src/infrastructure/supabase/repositories')
const MIGRATION = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/083_agent_reply.sql'), 'utf8')

const CASES = [
  { table: 'agent_messages', file: 'agent-message-repository.ts' },
  { table: 'agent_silences', file: 'agent-message-repository.ts' },
  { table: 'restaurants', file: 'agent-config-repository.ts' },
  { table: 'members', file: 'agent-tool-repository.ts' },
  { table: 'member_stamp_cards', file: 'agent-tool-repository.ts' },
]

/** Filter columns per `.from('table')` chunk (`.eq('col'`, `.gte('col'`, ...). */
function filterColumnsByTable(file: string): Map<string, string[]> {
  const source = fs.readFileSync(path.join(REPOS_DIR, file), 'utf8')
  const sites = [...source.matchAll(/\.from\(\s*'([a-z_]+)'\s*\)/g)]
  const out = new Map<string, string[]>()
  sites.forEach((site, i) => {
    const chunk = source.slice(site.index, i + 1 < sites.length ? sites[i + 1].index : source.length)
    const cols = [...chunk.matchAll(/\.(?:eq|is|gt|gte|lt|in|order)\(\s*'([a-z_]+)'/g)].map((m) => m[1])
    out.set(site[1], [...(out.get(site[1]) ?? []), ...cols])
  })
  return out
}

describe('AC-MIG agent schema contract: repositories match migration 083', () => {
  for (const { table, file } of CASES) {
    it(`AC-MIG ${file} only selects/writes columns that exist on ${table}`, () => {
      const schema = columnsForTable(table)
      const raw = repositoryColumnsByTable(path.join(REPOS_DIR, file)).get(table) ?? new Set<string>()
      // The parser splits an embedded resource `stamp_campaigns(name, name_zh)` on commas; that embed is checked below.
      const used = [...raw].filter((c) => !/[()]/.test(c))
      expect(used.length).toBeGreaterThan(0)
      expect(used.filter((c) => !schema.has(c)).sort()).toEqual([])
    })
  }

  it('AC-MIG the stamp-card embed reads existing stamp_campaigns columns through campaign_id', () => {
    const source = fs.readFileSync(path.join(REPOS_DIR, 'agent-tool-repository.ts'), 'utf8')
    expect(source).toContain("stamp_campaigns(name, name_zh)")
    const campaigns = columnsForTable('stamp_campaigns')
    expect(campaigns.has('name') && campaigns.has('name_zh')).toBe(true)
    expect(columnsForTable('member_stamp_cards').has('campaign_id')).toBe(true)
  })

  it('AC-MIG filter columns exist on the tables they filter', () => {
    for (const file of ['agent-message-repository.ts', 'agent-tool-repository.ts', 'agent-config-repository.ts']) {
      for (const [table, cols] of filterColumnsByTable(file)) {
        const schema = columnsForTable(table)
        for (const c of cols) expect(schema.has(c), `${file}: ${table}.${c}`).toBe(true)
      }
    }
  })

  it('AC-MIG 083 creates the agent tables with exactly the planned columns', () => {
    expect([...columnsForTable('agent_messages')].sort()).toEqual(
      ['created_at', 'id', 'latency_ms', 'model', 'outcome', 'phone', 'restaurant_id', 'role', 'text', 'tool_calls', 'wamid'].sort()
    )
    expect([...columnsForTable('agent_silences')].sort()).toEqual(['created_at', 'phone', 'restaurant_id', 'silenced_until'])
    expect(columnsForTable('restaurants').has('agent_config')).toBe(true)
  })

  it('AC-MIG RLS is enabled on both tables and 083 adds no policy and no grant', () => {
    expect(MIGRATION).toMatch(/ALTER TABLE agent_messages ENABLE ROW LEVEL SECURITY;/)
    expect(MIGRATION).toMatch(/ALTER TABLE agent_silences ENABLE ROW LEVEL SECURITY;/)
    expect(MIGRATION).not.toMatch(/CREATE POLICY/i)
    expect(MIGRATION).not.toMatch(/\bGRANT\b/i)
  })

  it('AC-MIG the outcome CHECK matches the domain enum; mode CHECK matches the VO modes', () => {
    const check = /outcome\s+TEXT CHECK \(outcome IN \(([^)]*)\)\)/.exec(MIGRATION)?.[1] ?? ''
    expect(check.split(',').map((s) => s.trim().replace(/'/g, ''))).toEqual([...AGENT_OUTCOMES])
    expect(MIGRATION).toContain("IN ('off', 'shadow', 'auto')")
    expect(MIGRATION).toContain(`DEFAULT '{"mode":"off"}'::jsonb`)
  })
})

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
import { AGENT_OUTCOMES, REPLY_CLAIM_OUTCOMES } from '@/domain/ports/agent-reply'

const REPOS_DIR = path.join(process.cwd(), 'src/infrastructure/supabase/repositories')
const MIGRATION = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/083_agent_reply.sql'), 'utf8')
/** AGENT-003 R19: 085 redefines the outcome CHECK and the one-reply index (adds 'handoff'); the latest definition is the live one. */
const MIGRATION_085 = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/085_agent_booking_changes.sql'), 'utf8')

const CASES = [
  { table: 'agent_messages', file: 'agent-message-repository.ts' },
  { table: 'agent_silences', file: 'agent-message-repository.ts' },
  { table: 'agent_messages', file: 'agent-conversation-repository.ts' },
  { table: 'restaurants', file: 'agent-config-repository.ts' },
  { table: 'members', file: 'agent-tool-repository.ts' },
  { table: 'member_stamp_cards', file: 'agent-tool-repository.ts' },
  // AGENT-006: get_recent_campaigns.
  { table: 'whatsapp_messages', file: 'agent-campaign-repository.ts' },
  { table: 'campaigns', file: 'agent-campaign-repository.ts' },
  { table: 'whatsapp_templates', file: 'agent-campaign-repository.ts' },
  // AGENT-006 fix 1: inline text in the diner's language, template edited after the send.
  { table: 'members', file: 'agent-campaign-repository.ts' },
  { table: 'restaurants', file: 'agent-campaign-repository.ts' },
]

/** Filter columns per `.from('table')` chunk (`.eq('col'`, `.gte('col'`, ...). */
function filterColumnsByTable(file: string): Map<string, string[]> {
  const source = fs.readFileSync(path.join(REPOS_DIR, file), 'utf8')
  const sites = [...source.matchAll(/\.from\(\s*'([a-z_]+)'\s*\)/g)]
  const out = new Map<string, string[]>()
  sites.forEach((site, i) => {
    const chunk = source.slice(site.index, i + 1 < sites.length ? sites[i + 1].index : source.length)
    const cols = [...chunk.matchAll(/\.(?:eq|is|not|gt|gte|lt|in|order)\(\s*'([a-z_]+)'/g)].map((m) => m[1])
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
    for (const file of ['agent-message-repository.ts', 'agent-tool-repository.ts', 'agent-config-repository.ts', 'agent-conversation-repository.ts', 'agent-campaign-repository.ts']) {
      for (const [table, cols] of filterColumnsByTable(file)) {
        const schema = columnsForTable(table)
        for (const c of cols) expect(schema.has(c), `${file}: ${table}.${c}`).toBe(true)
      }
    }
  })

  it('AC-MIG 083 creates the agent tables with exactly the planned columns', () => {
    expect([...columnsForTable('agent_messages')].sort()).toEqual(
      ['created_at', 'id', 'latency_ms', 'model', 'outcome', 'phone', 'reply_to_message_id', 'restaurant_id', 'role', 'text', 'tool_calls', 'wamid'].sort()
    )
    expect([...columnsForTable('agent_silences')].sort()).toEqual(['created_at', 'phone', 'restaurant_id', 'silenced_until'])
    expect(columnsForTable('restaurants').has('agent_config')).toBe(true)
  })

  it('AC-F7-MIG one answer per user row: partial UNIQUE on reply_to_message_id over exactly the claim outcomes', () => {
    const index = /CREATE UNIQUE INDEX agent_messages_one_reply_key\s+ON agent_messages \(reply_to_message_id\)\s+WHERE reply_to_message_id IS NOT NULL AND outcome IN \(([^)]*)\);/.exec(MIGRATION_085)
    expect(MIGRATION_085).toContain('DROP INDEX IF EXISTS agent_messages_one_reply_key;')
    expect(index).not.toBeNull()
    expect(index?.[1].split(',').map((s) => s.trim().replace(/'/g, '')).sort()).toEqual([...REPLY_CLAIM_OUTCOMES].sort())
    expect(MIGRATION).toMatch(/reply_to_message_id UUID REFERENCES agent_messages\(id\) ON DELETE SET NULL/)
    expect(MIGRATION).toContain("role = 'user' AND text IS NOT NULL AND outcome IS NULL AND reply_to_message_id IS NULL")
  })

  it('AC-MIG RLS is enabled on both tables and neither 083 nor 085 adds a policy or a table grant', () => {
    expect(MIGRATION_085).not.toMatch(/CREATE POLICY/i)
    expect(MIGRATION_085).not.toMatch(/GRANT [^;]* ON (TABLE )?agent_/i)
    expect(MIGRATION).toMatch(/ALTER TABLE agent_messages ENABLE ROW LEVEL SECURITY;/)
    expect(MIGRATION).toMatch(/ALTER TABLE agent_silences ENABLE ROW LEVEL SECURITY;/)
    expect(MIGRATION).not.toMatch(/CREATE POLICY/i)
    expect(MIGRATION).not.toMatch(/\bGRANT\b/i)
  })

  it('AC-MIG the outcome CHECK matches the domain enum; mode CHECK matches the VO modes', () => {
    const check = /agent_messages_outcome_check\s+CHECK \(outcome IN \(([^)]*)\)\)/.exec(MIGRATION_085)?.[1] ?? ''
    expect(check.split(',').map((s) => s.trim().replace(/'/g, ''))).toEqual([...AGENT_OUTCOMES])
    expect(MIGRATION_085).toContain('ALTER TABLE agent_messages DROP CONSTRAINT IF EXISTS agent_messages_outcome_check;')
    expect(MIGRATION).toContain("IN ('off', 'shadow', 'auto')")
    expect(MIGRATION).toContain(`DEFAULT '{"mode":"off"}'::jsonb`)
  })
})

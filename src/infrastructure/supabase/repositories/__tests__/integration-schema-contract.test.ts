// INT-001 WI-19 (D2): a repository that selects/writes a column the
// migrations never created is a silent failure in production -- unit tests
// against a fake Supabase client never notice (the fake doesn't know the
// real schema either), and the scratch-DB gate validates the SQL files, not
// every repository's own column strings. `integration-delivery-repository.ts`
// read/wrote `response_excerpt`; migration 071 actually created
// `last_response_excerpt` -- the prod relay scheduler failed every ~30s
// (see D2, .claude-workspace/deploys/2026-09-10-int-001-release-runbook.md).
//
// This test parses BOTH sides statically -- migrations -> real schema,
// repository source -> columns actually used -- and diffs them per table,
// so a rename on one side without the other fails HERE, not on a prod
// smoke minutes after a deploy. It is data-driven so a NEW INT-001
// repository/table pair only needs one line added to CASES below, never a
// new hand-written test.
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { columnsForTable } from './schema-contract/parse-schema'
import { repositoryColumnsByTable } from './schema-contract/parse-repository-columns'

const REPOS_DIR = path.join(process.cwd(), 'src/infrastructure/supabase/repositories')

// The six tables migrations 069-071 created for INT-001. Most repository
// files touch exactly one; integration-event-repository.ts's
// pruneOrphanIntegrationEvents also reads `integration_deliveries.event_id`
// via its own `.from('integration_deliveries')` call, so it gets a second
// case here rather than being silently unchecked.
const CASES = [
  { table: 'integration_settings', file: 'integration-settings-repository.ts' },
  { table: 'integration_settings_audit', file: 'integration-settings-audit-repository.ts' },
  { table: 'integration_member_jobs', file: 'integration-member-job-repository.ts' },
  { table: 'integration_member_refs', file: 'integration-member-ref-repository.ts' },
  { table: 'integration_events', file: 'integration-event-repository.ts' },
  { table: 'integration_deliveries', file: 'integration-event-repository.ts' },
  { table: 'integration_deliveries', file: 'integration-delivery-repository.ts' },
]

describe('INT-001 schema contract: repository columns exist on their table (D2)', () => {
  for (const { table, file } of CASES) {
    it(`${file} only references columns of ${table} that exist on it`, () => {
      const schema = columnsForTable(table)
      const used = repositoryColumnsByTable(path.join(REPOS_DIR, file)).get(table) ?? new Set<string>()
      const unknownColumns = [...used].filter((column) => !schema.has(column)).sort()

      expect(unknownColumns, `${file} references column(s) not found on ${table}: ${unknownColumns.join(', ')}`).toEqual([])
    })
  }
})

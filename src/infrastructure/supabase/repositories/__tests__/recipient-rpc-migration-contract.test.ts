// #162 / CAMP-013: the send path resolves recipients through the migration
// 079 RPCs. Nothing in the TS unit tests can see the SQL, so a migration
// that drops a tenant predicate, a status filter or the lockdown would ship
// green -- exactly the failure class the INT-001 schema-contract test was
// written for (D2, integration-schema-contract.test.ts).
//
// This test parses 079 statically and ties it to the TS side:
//   - RETURNS TABLE column list === MEMBER_COLUMNS (what mapRowToMember reads)
//   - both tenant predicates, the status filter, the total order and the
//     p_limit/p_offset paging contract are present
//   - the tags RPC's WHERE clause is character-identical (whitespace
//     normalised) to migration 067's, so the live recipient COUNT and the
//     actual send set cannot diverge
//   - both functions carry the migration-064 lockdown on their exact
//     signature and are LANGUAGE sql STABLE
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { MEMBER_COLUMNS } from '@/application/resolve-campaign-members'

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase', 'migrations')

const TAGS_FN = 'active_members_by_tags'
const SELECTION_FN = 'active_members_by_campaign_selection'
const SIGNATURES: Record<string, string> = {
  [TAGS_FN]: '(uuid, uuid[], int, int)',
  [SELECTION_FN]: '(uuid, uuid, int, int)',
}

function readMigration(prefix: string): string {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.sql'))
  expect(files, `expected exactly one ${prefix}* migration`).toHaveLength(1)
  return fs.readFileSync(path.join(MIGRATIONS_DIR, files[0]), 'utf8')
}

/** The `CREATE OR REPLACE FUNCTION ... ` text up to its language clause. */
function functionSource(sql: string, name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`)
  expect(start, `${name} is not declared`).toBeGreaterThanOrEqual(0)
  const end = sql.indexOf('LANGUAGE sql STABLE', start)
  expect(end, `${name} is not LANGUAGE sql STABLE`).toBeGreaterThan(start)
  return sql.slice(start, end)
}

/** RETURNS TABLE column names, in declaration order. The declared list has
 * no nested parentheses (plain scalar types), so a non-greedy scan to the
 * first `)` is exact here. */
function returnsTableColumns(fnSource: string): string[] {
  const match = /RETURNS TABLE\s*\(([^)]*)\)/i.exec(fnSource)
  expect(match, 'no RETURNS TABLE declaration').not.toBeNull()
  return match![1]
    .split(',')
    .map((segment) => segment.trim().split(/\s+/)[0])
    .filter((name) => name.length > 0)
}

/** The WHERE clause with runs of whitespace collapsed, so two migrations
 * that differ only in alignment compare equal. */
function normalisedWhere(fnSource: string): string {
  const match = /WHERE([\s\S]*?)(?:ORDER BY|LIMIT|;|\$\$)/i.exec(fnSource)
  expect(match, 'no WHERE clause').not.toBeNull()
  return match![1].replace(/\s+/g, ' ').trim()
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Counts grants/revokes tolerantly of the alignment padding 067 uses
 * (`GRANT  EXECUTE`), but strictly on the function's exact signature. */
function grantCount(sql: string, keyword: string, signature: string): number {
  const pattern = new RegExp(
    `${keyword}\\s+EXECUTE ON FUNCTION ${escapeRegExp(signature)}\\s`,
    'g'
  )
  return [...sql.matchAll(pattern)].length
}

const migration079 = readMigration('079_')
const migration067 = readMigration('067_')

describe('migration 079: recipient RPC contract (#162)', () => {
  for (const name of [TAGS_FN, SELECTION_FN]) {
    describe(name, () => {
      const source = () => functionSource(migration079, name)

      it('returns exactly the columns mapRowToMember consumes, in order', () => {
        expect(returnsTableColumns(source())).toEqual(MEMBER_COLUMNS.split(', '))
      })

      it('scopes to the caller tenant and to active members only', () => {
        expect(source()).toContain('m.restaurant_id = p_restaurant_id')
        expect(source()).toContain("m.status = 'active'")
      })

      it('applies a total order and the p_limit/p_offset paging contract', () => {
        expect(source()).toContain('ORDER BY m.id')
        expect(source()).toContain('LIMIT p_limit OFFSET p_offset')
      })

      it('is LANGUAGE sql STABLE and not SECURITY DEFINER', () => {
        const declaration = source()
        const after = migration079.slice(
          migration079.indexOf(declaration) + declaration.length
        )
        expect(after).toMatch(/^LANGUAGE sql STABLE/)
        expect(declaration).not.toContain('SECURITY DEFINER')
      })

      it('is locked down to service_role on its exact signature (migration 064 pattern)', () => {
        const signature = `public.${name}${SIGNATURES[name]}`
        for (const grantee of ['PUBLIC', 'anon', 'authenticated']) {
          expect(migration079).toMatch(
            new RegExp(
              `REVOKE\\s+EXECUTE ON FUNCTION ${escapeRegExp(signature)} FROM ${grantee};`
            )
          )
        }
        expect(grantCount(migration079, 'REVOKE', signature)).toBe(3)
        expect(grantCount(migration079, 'GRANT', signature)).toBe(1)
        expect(migration079).toMatch(
          new RegExp(
            `GRANT\\s+EXECUTE ON FUNCTION ${escapeRegExp(signature)} TO service_role;`
          )
        )
      })
    })
  }

  it('the tags RPC filters on the tag array', () => {
    const source = functionSource(migration079, TAGS_FN)
    expect(source).toContain('mt.restaurant_id = p_restaurant_id')
    expect(source).toContain('mt.tag_id = ANY(p_tag_ids)')
  })

  it('the tags RPC dedupes a member carrying several selected tags', () => {
    expect(functionSource(migration079, TAGS_FN)).toContain('DISTINCT ON (m.id)')
  })

  it('the tags RPC selects the same rows migration 067 counts', () => {
    // Structural parity: the live recipient count the merchant is shown and
    // the set actually sent to must come from the same predicate.
    expect(normalisedWhere(functionSource(migration079, TAGS_FN))).toBe(
      normalisedWhere(functionSource(migration067, 'count_active_members_by_tags'))
    )
  })

  it('the selection RPC scopes through campaigns.restaurant_id (campaign_members has no tenant column)', () => {
    const source = functionSource(migration079, SELECTION_FN)
    expect(source).toContain('c.restaurant_id = p_restaurant_id')
    expect(source).toContain('cm.campaign_id = p_campaign_id')
  })
})

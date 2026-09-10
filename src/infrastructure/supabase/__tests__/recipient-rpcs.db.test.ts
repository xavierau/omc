/**
 * DB INTEGRATION TESTS for migration 079 (active_members_by_tags /
 * active_members_by_campaign_selection) — #162 / CAMP-013.
 *
 * WHY THIS FILE EXISTS. The unit tests in
 * src/application/__tests__/resolve-campaign-members.test.ts drive a mocked
 * `supabase.rpc`, so they can only ever prove what the CALLER does. Cross-
 * tenant isolation, `DISTINCT ON (m.id)` and `m.status = 'active'` are
 * properties of the SQL, and the 079 contract test greps that same SQL — a
 * migration edit that keeps the substrings but changes the join or boolean
 * structure (OR-ing a predicate, dropping `mt.restaurant_id`, DISTINCT ON a
 * different column) would satisfy every one of them. These assertions run
 * against a real Postgres, which is the only thing that can tell the
 * difference (review: Grok Important, 2026-09-10).
 *
 * Gated behind `RUN_DB_TESTS=1` exactly like stamp-rpc.db.test.ts and
 * coupon-claim-idempotency.db.test.ts, so `npm test` stays green with no
 * database. It differs from those two in HOW it connects: they go through
 * PostgREST with supabase-js, and no PostgREST fronts a scratch database, so
 * this talks to Postgres directly through `psql` (no new dependency — the
 * repo has no `pg` driver, and these assertions are SQL-level anyway).
 *
 * HOW TO RUN (the run recorded in
 * .claude-workspace/artifacts/2026-09-10-camp-012-013-review-fixes-backend.md):
 *   1. Build a scratch DB and apply every migration 001..079 to it (the
 *      technique is the INT-001 / CAMP-013 scratch script: fresh database,
 *      stub auth/storage/extensions/realtime, then `psql -f` each migration
 *      in filename order).
 *   2. PGDATABASE=scratch_camp_fix RUN_DB_TESTS=1 npx vitest run \
 *        src/infrastructure/supabase/__tests__/recipient-rpcs.db.test.ts
 *
 * Connection comes from the standard libpq env vars; the defaults point at
 * the local Docker Postgres, and PGDATABASE deliberately defaults to a
 * scratch name that does not normally exist, so a misfire fails loudly
 * instead of writing fixtures into a real database.
 */
import { execFileSync } from 'node:child_process'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const RUN = process.env.RUN_DB_TESTS === '1'
const d = RUN ? describe : describe.skip

const PG = {
  host: process.env.PGHOST ?? '127.0.0.1',
  port: process.env.PGPORT ?? '54322',
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD ?? 'postgres',
  database: process.env.PGDATABASE ?? 'scratch_camp_fix',
}

function psql(sql: string): string {
  return execFileSync(
    'psql',
    ['-h', PG.host, '-p', PG.port, '-U', PG.user, '-d', PG.database, '-v', 'ON_ERROR_STOP=1', '-tAc', sql],
    { env: { ...process.env, PGPASSWORD: PG.password }, encoding: 'utf8' }
  ).trim()
}

function scalar(sql: string): number {
  return Number(psql(sql))
}

function names(sql: string): string[] {
  const out = psql(sql)
  return out.length === 0 ? [] : out.split('\n')
}

// Tenants A and B. A has a1,a2 active, a3 unsubscribed, a4 active; a4 is
// reachable ONLY through a poisoned member_tags row. B has b1 active.
const REST_A = 'aaaaaaaa-0000-0000-0000-00000000c013'
const REST_B = 'bbbbbbbb-0000-0000-0000-00000000c013'
const A1 = 'a1111111-0000-0000-0000-00000000c013'
const A2 = 'a2222222-0000-0000-0000-00000000c013'
const A3_UNSUB = 'a3333333-0000-0000-0000-00000000c013'
const A4_POISONED = 'a4444444-0000-0000-0000-00000000c013'
const B1 = 'b1111111-0000-0000-0000-00000000c013'
const TAG_A1 = '7a111111-0000-0000-0000-00000000c013'
const TAG_A2 = '7a222222-0000-0000-0000-00000000c013'
const CAMPAIGN_A = 'caaaaaaa-0000-0000-0000-00000000c013'

const TAGS = (restaurantId: string, tagIds: string[]) =>
  `active_members_by_tags('${restaurantId}'::uuid, ARRAY[${tagIds.map((t) => `'${t}'`).join(',')}]::uuid[])`
const SELECTION = (restaurantId: string, campaignId: string) =>
  `active_members_by_campaign_selection('${restaurantId}'::uuid, '${campaignId}'::uuid)`

const CLEANUP = `DELETE FROM restaurants WHERE id IN ('${REST_A}', '${REST_B}');`

const SEED = `
${CLEANUP}
INSERT INTO restaurants (id, name, slug, whatsapp_number) VALUES
  ('${REST_A}', 'Tenant A (camp013 fix)', 'tenant-a-camp013-fix', '85290000101'),
  ('${REST_B}', 'Tenant B (camp013 fix)', 'tenant-b-camp013-fix', '85290000102');

INSERT INTO members (id, restaurant_id, phone, name, status) VALUES
  ('${A1}', '${REST_A}', '+85291000101', 'A1', 'active'),
  ('${A2}', '${REST_A}', '+85291000102', 'A2', 'active'),
  ('${A3_UNSUB}', '${REST_A}', '+85291000103', 'A3', 'unsubscribed'),
  ('${A4_POISONED}', '${REST_A}', '+85291000104', 'A4', 'active'),
  ('${B1}', '${REST_B}', '+85292000101', 'B1', 'active');

INSERT INTO tags (id, restaurant_id, name) VALUES
  ('${TAG_A1}', '${REST_A}', 'tA1-fix'),
  ('${TAG_A2}', '${REST_A}', 'tA2-fix');

INSERT INTO member_tags (member_id, tag_id, restaurant_id) VALUES
  -- honest rows: a1 carries BOTH tags, a2 one, a3 (unsubscribed) one
  ('${A1}', '${TAG_A1}', '${REST_A}'),
  ('${A1}', '${TAG_A2}', '${REST_A}'),
  ('${A2}', '${TAG_A1}', '${REST_A}'),
  ('${A3_UNSUB}', '${TAG_A1}', '${REST_A}'),
  -- POISON-1: tenant B's member on tenant A's tag, row claims A.
  -- Only the m.restaurant_id predicate can kill this one.
  ('${B1}', '${TAG_A1}', '${REST_A}'),
  -- POISON-2: tenant A's member on tenant A's tag, row claims B.
  -- Only the mt.restaurant_id predicate can kill this one for an A call.
  ('${A4_POISONED}', '${TAG_A1}', '${REST_B}');

INSERT INTO campaigns (id, restaurant_id, type, template, target_audience) VALUES
  ('${CAMPAIGN_A}', '${REST_A}', 'promo', 'hi', 'selected');

INSERT INTO campaign_members (campaign_id, member_id) VALUES
  ('${CAMPAIGN_A}', '${A1}'),
  ('${CAMPAIGN_A}', '${A3_UNSUB}'),
  ('${CAMPAIGN_A}', '${B1}');
`

beforeAll(() => {
  if (!RUN) return
  psql(SEED)
})

afterAll(() => {
  if (!RUN) return
  psql(CLEANUP)
})

d('migration 079 — cross-tenant isolation (both restaurant_id predicates)', () => {
  it('a poisoned member_tags row claiming tenant A does not leak tenant B\'s member into an A send', () => {
    expect(
      scalar(`SELECT count(*) FROM ${TAGS(REST_A, [TAG_A1])} WHERE id = '${B1}'`)
    ).toBe(0)
  })

  it('a poisoned member_tags row claiming tenant B is not honoured on an A call', () => {
    expect(
      scalar(`SELECT count(*) FROM ${TAGS(REST_A, [TAG_A1])} WHERE id = '${A4_POISONED}'`)
    ).toBe(0)
  })

  it('resolves exactly the honest active members of the tag, and nothing else', () => {
    expect(names(`SELECT name FROM ${TAGS(REST_A, [TAG_A1])} ORDER BY name`)).toEqual(['A1', 'A2'])
  })

  it('tenant B resolves no recipients from tenant A\'s tag', () => {
    expect(scalar(`SELECT count(*) FROM ${TAGS(REST_B, [TAG_A1])}`)).toBe(0)
  })
})

d('migration 079 — a member on two selected tags is ONE recipient (DISTINCT ON)', () => {
  it('returns the two-tag member exactly once', () => {
    expect(
      scalar(`SELECT count(*) FROM ${TAGS(REST_A, [TAG_A1, TAG_A2])} WHERE id = '${A1}'`)
    ).toBe(1)
  })

  it('returns each member of the union exactly once', () => {
    expect(names(`SELECT name FROM ${TAGS(REST_A, [TAG_A1, TAG_A2])} ORDER BY name`)).toEqual(['A1', 'A2'])
  })
})

d('migration 079 — unsubscribed members never reach the worker', () => {
  it('excludes an unsubscribed member from the tags RPC', () => {
    expect(
      scalar(`SELECT count(*) FROM ${TAGS(REST_A, [TAG_A1])} WHERE id = '${A3_UNSUB}'`)
    ).toBe(0)
  })

  it('excludes an unsubscribed member from the selection RPC', () => {
    expect(
      scalar(`SELECT count(*) FROM ${SELECTION(REST_A, CAMPAIGN_A)} WHERE id = '${A3_UNSUB}'`)
    ).toBe(0)
  })

  it('the unsubscribed member IS linked to the tag and IS selected (the filter is doing the work)', () => {
    // Without this control the two assertions above pass on an empty fixture.
    expect(
      scalar(`SELECT count(*) FROM member_tags WHERE member_id = '${A3_UNSUB}' AND tag_id = '${TAG_A1}'`)
    ).toBe(1)
    expect(
      scalar(`SELECT count(*) FROM campaign_members WHERE campaign_id = '${CAMPAIGN_A}' AND member_id = '${A3_UNSUB}'`)
    ).toBe(1)
  })
})

d('migration 079 — the send set is the set migration 067 counts', () => {
  const subsets: Array<[string, string[]]> = [
    ['{tA1}', [TAG_A1]],
    ['{tA2}', [TAG_A2]],
    ['{tA1,tA2}', [TAG_A1, TAG_A2]],
  ]

  it.each(subsets)('row count of active_members_by_tags %s equals count_active_members_by_tags', (_label, tagIds) => {
    const rows = scalar(`SELECT count(*) FROM ${TAGS(REST_A, tagIds)}`)
    const counted = scalar(
      `SELECT count_active_members_by_tags('${REST_A}'::uuid, ARRAY[${tagIds.map((t) => `'${t}'`).join(',')}]::uuid[])`
    )
    expect(rows).toBe(counted)
    expect(rows).toBeGreaterThan(0)
  })
})

d('migration 079 — the selection RPC is scoped by campaigns.restaurant_id', () => {
  it('tenant A resolves only its own active selected member', () => {
    expect(names(`SELECT name FROM ${SELECTION(REST_A, CAMPAIGN_A)} ORDER BY name`)).toEqual(['A1'])
  })

  it('tenant B resolving tenant A\'s campaign gets nothing (campaign_members has no tenant column)', () => {
    expect(scalar(`SELECT count(*) FROM ${SELECTION(REST_B, CAMPAIGN_A)}`)).toBe(0)
  })

  it('a cross-tenant member sitting in the selection is not returned', () => {
    expect(
      scalar(`SELECT count(*) FROM ${SELECTION(REST_A, CAMPAIGN_A)} WHERE id = '${B1}'`)
    ).toBe(0)
    expect(
      scalar(`SELECT count(*) FROM campaign_members WHERE campaign_id = '${CAMPAIGN_A}' AND member_id = '${B1}'`)
    ).toBe(1)
  })
})

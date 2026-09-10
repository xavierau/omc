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
 * HOW TO RUN. Nothing runs these by default -- `RUN_DB_TESTS=1` is the gate,
 * and this repo has no CI to set it (review F3), so the entry point is the
 * `test:db` npm script and this paragraph. Two things are REQUIRED, and the
 * script supplies only the first: `RUN_DB_TESTS=1` un-skips the suites, and
 * `PGDATABASE` must name a scratch database with migrations 001..079 applied
 * -- it deliberately defaults to `scratch_camp_fix`, a name that does not
 * normally exist, so a misfire fails loudly instead of seeding fixtures into
 * a real database. The rest of the connection comes from the standard libpq
 * env vars (PGHOST/PGPORT/PGUSER/PGPASSWORD), defaulted to the local Docker
 * Postgres.
 *
 *   1. Build the scratch DB: create a fresh database, stub
 *      auth/storage/extensions/realtime, then `psql -f` every migration in
 *      filename order (the INT-001 / CAMP-013 scratch-script technique; the
 *      run is recorded in
 *      .claude-workspace/artifacts/2026-09-10-camp-012-013-gstack-review-fixes-backend.md).
 *   2. PGDATABASE=<scratch db> npm run test:db
 *
 * `npm run test:db` runs EVERY gated file in this directory. Today only this
 * one connects to a scratch database; the other four
 * (stamp-rpc / stamp-rls / platform-settings / coupon-claim-idempotency) go
 * through PostgREST with supabase-js and say in their own headers that the
 * rig they need was never built, so they FAIL rather than skip once the gate
 * is open. Until that rig exists, run this file alone:
 *
 *   PGDATABASE=<scratch db> RUN_DB_TESTS=1 npx vitest run \
 *     src/infrastructure/supabase/__tests__/recipient-rpcs.db.test.ts
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

// Paging fixture (review F4): 1,500 active tenant-A members, all carrying
// tBULK and all selected into cBULK. 1,500 is the smallest audience that
// spans two p_limit=1000 pages unevenly, so a boundary that loses or repeats
// rows shows up as a wrong count rather than a wrong-but-plausible one.
const TAG_BULK = '7a333333-0000-0000-0000-00000000c013'
const CAMPAIGN_BULK = 'cbbbbbbb-0000-0000-0000-00000000c013'
const BULK_COUNT = 1500
const PAGE = 1000
const bulkMemberId = (n: string) =>
  `('c0000000-0000-0000-0000-' || lpad(${n}, 12, '0'))::uuid`

const TAGS = (restaurantId: string, tagIds: string[]) =>
  `active_members_by_tags('${restaurantId}'::uuid, ARRAY[${tagIds.map((t) => `'${t}'`).join(',')}]::uuid[])`
const SELECTION = (restaurantId: string, campaignId: string) =>
  `active_members_by_campaign_selection('${restaurantId}'::uuid, '${campaignId}'::uuid)`

// The 4-arg forms -- the shape readAllPages actually calls. `null` is the
// p_limit NULL default, i.e. the whole set.
const TAGS_PAGE = (
  restaurantId: string,
  tagIds: string[],
  limit: number | null,
  offset: number
) =>
  `active_members_by_tags('${restaurantId}'::uuid, ARRAY[${tagIds
    .map((t) => `'${t}'`)
    .join(',')}]::uuid[], ${limit ?? 'NULL'}, ${offset})`
const SELECTION_PAGE = (
  restaurantId: string,
  campaignId: string,
  limit: number | null,
  offset: number
) =>
  `active_members_by_campaign_selection('${restaurantId}'::uuid, '${campaignId}'::uuid, ${limit ?? 'NULL'}, ${offset})`

const ids = (source: string) => `SELECT id FROM ${source}`
const countOf = (setExpression: string) =>
  scalar(`SELECT count(*) FROM (${setExpression}) x`)

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
  ('${TAG_A2}', '${REST_A}', 'tA2-fix'),
  ('${TAG_BULK}', '${REST_A}', 'tBULK-fix');

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

INSERT INTO members (id, restaurant_id, phone, name, status)
SELECT ${bulkMemberId('g::text')}, '${REST_A}',
       '+8529900' || lpad(g::text, 4, '0'), 'Bulk ' || g, 'active'
FROM generate_series(1, ${BULK_COUNT}) g;

INSERT INTO member_tags (member_id, tag_id, restaurant_id)
SELECT ${bulkMemberId('g::text')}, '${TAG_BULK}', '${REST_A}'
FROM generate_series(1, ${BULK_COUNT}) g;

INSERT INTO campaigns (id, restaurant_id, type, template, target_audience) VALUES
  ('${CAMPAIGN_BULK}', '${REST_A}', 'promo', 'hi', 'selected');

INSERT INTO campaign_members (campaign_id, member_id)
SELECT '${CAMPAIGN_BULK}', ${bulkMemberId('g::text')}
FROM generate_series(1, ${BULK_COUNT}) g;
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

/**
 * Review F4. Every committed proof of the p_limit/p_offset contract was
 * either a mock that slices in JavaScript (resolve-campaign-members.test.ts
 * B4/B5) or a `toContain('LIMIT p_limit OFFSET p_offset')` substring grep.
 * Neither can see an edit that moves LIMIT/OFFSET above the DISTINCT ON, or
 * wraps the body in a subquery that re-sorts: the substrings survive, the
 * unit tests survive, and a 1,500-member audience quietly loses or repeats
 * members at the page boundary. `dedupeById` hides the repeat and cannot see
 * the drop, so the symptom is a completed campaign, a correct-looking
 * recipient count, and customers who got nothing.
 *
 * The claim is therefore set-level, not count-level: the two pages must
 * PARTITION the p_limit NULL result -- disjoint, and covering it exactly.
 */
d('migration 079 — the p_limit/p_offset window partitions the full set', () => {
  const cases: Array<[string, (limit: number | null, offset: number) => string]> = [
    ['active_members_by_tags', (limit, offset) => TAGS_PAGE(REST_A, [TAG_BULK], limit, offset)],
    [
      'active_members_by_campaign_selection',
      (limit, offset) => SELECTION_PAGE(REST_A, CAMPAIGN_BULK, limit, offset),
    ],
  ]

  it.each(cases)('%s pages a 1,500-row audience as 1000 + 500, then empty', (_name, page) => {
    expect(scalar(`SELECT count(*) FROM ${page(null, 0)}`)).toBe(BULK_COUNT)
    expect(scalar(`SELECT count(*) FROM ${page(PAGE, 0)}`)).toBe(PAGE)
    expect(scalar(`SELECT count(*) FROM ${page(PAGE, PAGE)}`)).toBe(BULK_COUNT - PAGE)
    expect(scalar(`SELECT count(*) FROM ${page(PAGE, BULK_COUNT)}`)).toBe(0)
  })

  it.each(cases)('%s pages are disjoint and their union IS the p_limit NULL result', (_name, page) => {
    const first = ids(page(PAGE, 0))
    const second = ids(page(PAGE, PAGE))
    const whole = ids(page(null, 0))

    expect(countOf(`${first} INTERSECT ${second}`)).toBe(0)
    expect(countOf(`(${first} UNION ${second}) EXCEPT ${whole}`)).toBe(0)
    expect(countOf(`${whole} EXCEPT (${first} UNION ${second})`)).toBe(0)
    expect(countOf(`${first} UNION ${second}`)).toBe(BULK_COUNT)
  })
})

/**
 * DB INTEGRATION TESTS for migration 086 (campaign_audience_members /
 * campaign_audience_counts) — CAMP-016.
 *
 * The audience resolver decides who a campaign is sent to and what the
 * campaign form shows before it is created. Tenant isolation, the lapsed
 * filter and the quality exclusion are properties of the SQL, so they are
 * asserted against a real Postgres, same rig as recipient-rpcs.db.test.ts:
 * gated on RUN_DB_TESTS=1, talks to Postgres through `psql`, and PGDATABASE
 * defaults to a name that does not normally exist so a misfire fails loudly.
 *
 *   RUN_DB_TESTS=1 PGPORT=<port> PGUSER=<superuser> PGDATABASE=<scratch db> \
 *     npx vitest run src/infrastructure/supabase/__tests__/campaign-audience-rpcs.db.test.ts
 *
 * The thresholds are passed in from contact-quality.ts, exactly as the
 * repository does, so this file also proves the SQL classification matches
 * classifyContactQuality on the boundary values (0.9 and 0.6 exactly).
 */
import { execFileSync } from 'node:child_process'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  CONTACT_QUALITY_THRESHOLDS,
  CONTACT_QUALITY_WINDOW_DAYS,
  classifyContactQuality,
} from '@/domain/value-objects/contact-quality'

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

const rows = (sql: string): string[] => {
  const out = psql(sql)
  return out.length === 0 ? [] : out.split('\n')
}

// Tenant A: the scenario members. Tenant B: a foreign member and foreign
// message rows that must never affect A. Tenant C: the paging bulk set.
const REST_A = 'aaaaaaaa-0000-0000-0000-0000000c0016'
const REST_B = 'bbbbbbbb-0000-0000-0000-0000000c0016'
const REST_C = 'cccccccc-0000-0000-0000-0000000c0016'
const id = (n: number) => `a${String(n).padStart(7, '0')}-0000-0000-0000-0000000c0016`
const G1 = id(1) // 9 delivered / 1 failed = 0.9 exactly → green; lapsed 40d; VIP
const Y1 = id(2) // 6 / 4 = 0.6 exactly → yellow; visited 5d ago (NOT lapsed); VIP
const Y2 = id(3) // 7 / 3 → yellow; never visited; VIP
const R1 = id(4) // 5 / 5 → red; lapsed 60d; VIP
const R2 = id(5) // 10 delivered but unreachable_at set → red; lapsed; VIP
const N1 = id(6) // no messages → no data; lapsed 100d; VIP
const N2 = id(7) // only queued/sent (pending) → no data; lapsed; LUNCH only
const OLD = id(8) // only failed messages older than the window → no data; lapsed; VIP
const U1 = id(9) // unsubscribed, VIP, lapsed → never a recipient
const B1 = 'b0000001-0000-0000-0000-0000000c0016'
const TAG_VIP = '7a000001-0000-0000-0000-0000000c0016'
const TAG_LUNCH = '7a000002-0000-0000-0000-0000000c0016'
const CAMPAIGN_SEL = 'ca000001-0000-0000-0000-0000000c0016'
const BULK = 1600 // every 4th member red → 1,200 kept: two pages at p_limit 1000
const PAGE = 1000

const NAMES: Record<string, string> = {
  [G1]: 'G1', [Y1]: 'Y1', [Y2]: 'Y2', [R1]: 'R1', [R2]: 'R2', [N1]: 'N1', [N2]: 'N2', [OLD]: 'OLD', [U1]: 'U1', [B1]: 'B1',
}

const CLEANUP = `DELETE FROM restaurants WHERE id IN ('${REST_A}', '${REST_B}', '${REST_C}');`

const member = (mid: string, rest: string, phone: string, status: string, lastVisitDays: number | null, unreachable = false) =>
  `('${mid}', '${rest}', '${phone}', '${NAMES[mid] ?? 'x'}', '${status}', ${
    lastVisitDays === null ? 'NULL' : `now() - interval '${lastVisitDays} days'`
  }, ${unreachable ? 'now()' : 'NULL'})`

// n outbound messages for a member with a status, queued `ageDays` ago.
const msgs = (mid: string, rest: string, n: number, status: string, ageDays = 1) => `
INSERT INTO whatsapp_messages (restaurant_id, member_id, direction, category, message_type, status, queued_at, phone_e164)
SELECT '${rest}', '${mid}', 'outbound', 'marketing', 'template', '${status}', now() - interval '${ageDays} days', '+85200000000'
FROM generate_series(1, ${n});`

const SEED = `
${CLEANUP}
INSERT INTO restaurants (id, name, slug, whatsapp_number) VALUES
  ('${REST_A}', 'Tenant A (camp016)', 'tenant-a-camp016', '85290001601'),
  ('${REST_B}', 'Tenant B (camp016)', 'tenant-b-camp016', '85290001602'),
  ('${REST_C}', 'Tenant C (camp016)', 'tenant-c-camp016', '85290001603');

INSERT INTO members (id, restaurant_id, phone, name, status, last_visit_at, unreachable_at) VALUES
  ${member(G1, REST_A, '+85291601001', 'active', 40)},
  ${member(Y1, REST_A, '+85291601002', 'active', 5)},
  ${member(Y2, REST_A, '+85291601003', 'active', null)},
  ${member(R1, REST_A, '+85291601004', 'active', 60)},
  ${member(R2, REST_A, '+85291601005', 'active', 45, true)},
  ${member(N1, REST_A, '+85291601006', 'active', 100)},
  ${member(N2, REST_A, '+85291601007', 'active', 100)},
  ${member(OLD, REST_A, '+85291601008', 'active', 100)},
  ${member(U1, REST_A, '+85291601009', 'unsubscribed', 100)},
  ${member(B1, REST_B, '+85291602001', 'active', 100)};

INSERT INTO tags (id, restaurant_id, name) VALUES
  ('${TAG_VIP}', '${REST_A}', 'VIP-c16'),
  ('${TAG_LUNCH}', '${REST_A}', 'Lunch-c16');

INSERT INTO member_tags (member_id, tag_id, restaurant_id) VALUES
  ('${G1}', '${TAG_VIP}', '${REST_A}'), ('${Y1}', '${TAG_VIP}', '${REST_A}'),
  ('${Y2}', '${TAG_VIP}', '${REST_A}'), ('${R1}', '${TAG_VIP}', '${REST_A}'),
  ('${R2}', '${TAG_VIP}', '${REST_A}'), ('${N1}', '${TAG_VIP}', '${REST_A}'),
  ('${OLD}', '${TAG_VIP}', '${REST_A}'), ('${U1}', '${TAG_VIP}', '${REST_A}'),
  ('${N2}', '${TAG_LUNCH}', '${REST_A}'),
  ('${G1}', '${TAG_LUNCH}', '${REST_A}'),
  -- poisoned: tenant B's member on A's tag, row claims A
  ('${B1}', '${TAG_VIP}', '${REST_A}');

${msgs(G1, REST_A, 9, 'delivered')} ${msgs(G1, REST_A, 1, 'failed')}
${msgs(Y1, REST_A, 6, 'read')} ${msgs(Y1, REST_A, 4, 'failed')}
${msgs(Y2, REST_A, 7, 'delivered')} ${msgs(Y2, REST_A, 3, 'failed')}
${msgs(R1, REST_A, 5, 'delivered')} ${msgs(R1, REST_A, 5, 'failed')}
${msgs(R2, REST_A, 10, 'delivered')}
${msgs(N2, REST_A, 4, 'queued')} ${msgs(N2, REST_A, 4, 'sent')}
${msgs(OLD, REST_A, 6, 'failed', CONTACT_QUALITY_WINDOW_DAYS + 5)}
-- foreign rows pointing at A's green member: tenant B's failures must not count
${msgs(G1, REST_B, 50, 'failed')}

INSERT INTO campaigns (id, restaurant_id, type, template, target_audience) VALUES
  ('${CAMPAIGN_SEL}', '${REST_A}', 'promo', 'hi', 'selected');
INSERT INTO campaign_members (campaign_id, member_id) VALUES
  ('${CAMPAIGN_SEL}', '${Y1}'), ('${CAMPAIGN_SEL}', '${R1}'),
  ('${CAMPAIGN_SEL}', '${N1}'), ('${CAMPAIGN_SEL}', '${U1}'), ('${CAMPAIGN_SEL}', '${B1}');

INSERT INTO members (id, restaurant_id, phone, name, status, last_visit_at)
SELECT ('c0000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, '${REST_C}',
       '+8529916' || lpad(g::text, 4, '0'), 'Bulk ' || g, 'active', NULL
FROM generate_series(1, ${BULK}) g;
INSERT INTO whatsapp_messages (restaurant_id, member_id, direction, category, message_type, status, queued_at, phone_e164)
SELECT '${REST_C}', ('c0000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'outbound', 'marketing', 'template', 'failed', now() - interval '1 day', '+85200000000'
FROM generate_series(4, ${BULK}, 4) g;
`

interface Query {
  restaurantId: string
  audience: 'all' | 'selected' | 'tag'
  tagIds?: string[]
  memberIds?: string[]
  campaignId?: string | null
  lapsedDays?: number | null
  neverVisitedIsLapsed?: boolean
  skip?: 'off' | 'red' | 'red_yellow'
  green?: number
  yellow?: number
}

const uuidArray = (xs: string[] | undefined) =>
  xs && xs.length > 0 ? `ARRAY[${xs.map((x) => `'${x}'`).join(',')}]::uuid[]` : 'NULL::uuid[]'

function args(q: Query): string {
  return [
    `p_restaurant_id => '${q.restaurantId}'::uuid`,
    `p_audience => '${q.audience}'`,
    `p_tag_ids => ${uuidArray(q.tagIds)}`,
    `p_member_ids => ${uuidArray(q.memberIds)}`,
    `p_campaign_id => ${q.campaignId ? `'${q.campaignId}'::uuid` : 'NULL::uuid'}`,
    `p_lapsed_days => ${q.lapsedDays ?? 'NULL'}::int`,
    `p_never_visited_lapsed => ${q.neverVisitedIsLapsed ?? true}`,
    `p_skip => '${q.skip ?? 'off'}'`,
    `p_window_days => ${CONTACT_QUALITY_WINDOW_DAYS}`,
    `p_green => ${q.green ?? CONTACT_QUALITY_THRESHOLDS.green}::float8`,
    `p_yellow => ${q.yellow ?? CONTACT_QUALITY_THRESHOLDS.yellow}::float8`,
  ].join(', ')
}

const members = (q: Query, limit: number | null = null, offset = 0) =>
  rows(
    `SELECT id FROM campaign_audience_members(${args(q)}, p_limit => ${limit ?? 'NULL'}::int, p_offset => ${offset})`
  )

const named = (q: Query) => members(q).map((m) => NAMES[m] ?? m).sort()

function counts(q: Query) {
  const [line] = rows(
    `SELECT audience, after_lapsed, green, yellow, red, no_data, will_receive FROM campaign_audience_counts(${args(q)})`
  )
  const [audience, afterLapsed, green, yellow, red, noData, willReceive] = line.split('|').map(Number)
  return { audience, afterLapsed, green, yellow, red, noData, willReceive }
}

beforeAll(() => {
  if (!RUN) return
  psql(SEED)
})

afterAll(() => {
  if (!RUN) return
  psql(CLEANUP)
})

const VIP_LAPSED: Query = { restaurantId: REST_A, audience: 'tag', tagIds: [TAG_VIP], lapsedDays: 30 }

d('086 resolver — tags ∩ lapsed ∩ skip', () => {
  it('tags + lapsed 30 + skip red: drops the recent visitor and both reds, keeps no-data members', () => {
    expect(named({ ...VIP_LAPSED, skip: 'red' })).toEqual(['G1', 'N1', 'OLD', 'Y2'])
  })

  it('tags + lapsed 30 + skip red_yellow also drops yellow', () => {
    expect(named({ ...VIP_LAPSED, skip: 'red_yellow' })).toEqual(['G1', 'N1', 'OLD'])
  })

  it('skip off keeps every lapsed, active, tagged member', () => {
    expect(named({ ...VIP_LAPSED, skip: 'off' })).toEqual(['G1', 'N1', 'OLD', 'R1', 'R2', 'Y2'])
  })

  it('no lapsed filter keeps the recent visitor', () => {
    expect(named({ ...VIP_LAPSED, lapsedDays: null, skip: 'red' })).toEqual(['G1', 'N1', 'OLD', 'Y1', 'Y2'])
  })

  it('never-visited counts as lapsed, unless the legacy win-back mode asks otherwise', () => {
    expect(named({ ...VIP_LAPSED })).toContain('Y2')
    expect(named({ ...VIP_LAPSED, neverVisitedIsLapsed: false })).not.toContain('Y2')
  })

  it('no-data members are never excluded, at either skip level', () => {
    for (const skip of ['red', 'red_yellow'] as const) {
      const got = named({ restaurantId: REST_A, audience: 'all', skip })
      expect(got).toEqual(expect.arrayContaining(['N1', 'N2', 'OLD']))
    }
  })

  it('unreachable is red at skip red even with a perfect delivery rate', () => {
    expect(named({ restaurantId: REST_A, audience: 'all', skip: 'red' })).not.toContain('R2')
    expect(named({ restaurantId: REST_A, audience: 'all', skip: 'off' })).toContain('R2')
  })

  it('unsubscribed members are never recipients', () => {
    expect(named({ restaurantId: REST_A, audience: 'all' })).not.toContain('U1')
  })
})

d('086 resolver — classification matches classifyContactQuality', () => {
  const cases: Array<[string, { delivered: number; failed: number; unreachable: boolean }]> = [
    ['G1', { delivered: 9, failed: 1, unreachable: false }],
    ['Y1', { delivered: 6, failed: 4, unreachable: false }],
    ['Y2', { delivered: 7, failed: 3, unreachable: false }],
    ['R1', { delivered: 5, failed: 5, unreachable: false }],
    ['R2', { delivered: 10, failed: 0, unreachable: true }],
    ['N1', { delivered: 0, failed: 0, unreachable: false }],
  ]
  it.each(cases)('%s rates the same in SQL and TS', (name, input) => {
    const expected = classifyContactQuality(input).rating
    const mid = Object.keys(NAMES).find((k) => NAMES[k] === name)!
    const rating = psql(
      `SELECT rating FROM campaign_audience_rated(${args({ restaurantId: REST_A, audience: 'all' })}) WHERE id = '${mid}'`
    )
    expect(rating).toBe(expected)
  })

  it('thresholds are parameters, not constants in SQL', () => {
    // At green 0.95, G1 (exactly 0.9) is no longer green.
    const strict = counts({ restaurantId: REST_A, audience: 'tag', tagIds: [TAG_VIP], green: 0.95 })
    const normal = counts({ restaurantId: REST_A, audience: 'tag', tagIds: [TAG_VIP] })
    expect(normal.green - strict.green).toBe(1)
    expect(strict.yellow - normal.yellow).toBe(1)
  })
})

d('086 resolver — per-step counts and count/send parity', () => {
  it('counts give the summary steps for tags + lapsed + skip red', () => {
    expect(counts({ ...VIP_LAPSED, skip: 'red' })).toEqual({
      audience: 7, afterLapsed: 6, green: 1, yellow: 1, red: 2, noData: 2, willReceive: 4,
    })
  })

  it.each(['off', 'red', 'red_yellow'] as const)('will_receive equals the resolved set (skip %s)', (skip) => {
    for (const q of [
      { ...VIP_LAPSED, skip },
      { restaurantId: REST_A, audience: 'all' as const, skip },
      { restaurantId: REST_A, audience: 'selected' as const, campaignId: CAMPAIGN_SEL, lapsedDays: 30, skip },
    ]) {
      expect(counts(q).willReceive).toBe(members(q).length)
    }
  })

  it('count equals the paged walk across two pages (1,600 members, 400 red)', () => {
    const q: Query = { restaurantId: REST_C, audience: 'all', lapsedDays: 30, skip: 'red' }
    const seen: string[] = []
    for (let offset = 0; ; ) {
      const page = members(q, PAGE, offset)
      if (page.length === 0) break
      seen.push(...page)
      offset += page.length
    }
    expect(members(q, PAGE, 0)).toHaveLength(PAGE)
    expect(new Set(seen).size).toBe(seen.length)
    expect(seen).toHaveLength(1200)
    expect(counts(q)).toMatchObject({ audience: BULK, afterLapsed: BULK, red: 400, noData: 1200, willReceive: 1200 })
  })
})

d('086 resolver — selected audiences', () => {
  it('selected by campaign id: tenant-scoped, active only, filters apply', () => {
    const q: Query = { restaurantId: REST_A, audience: 'selected', campaignId: CAMPAIGN_SEL }
    expect(named(q)).toEqual(['N1', 'R1', 'Y1'])
    expect(named({ ...q, lapsedDays: 30, skip: 'red' })).toEqual(['N1'])
  })

  it('selected by member ids (form preview) gives the same set as the saved selection', () => {
    const ids = [Y1, R1, N1, U1, B1]
    const byIds: Query = { restaurantId: REST_A, audience: 'selected', memberIds: ids, lapsedDays: 30, skip: 'red' }
    expect(named(byIds)).toEqual(['N1'])
    expect(counts(byIds).audience).toBe(3)
  })

  it("another tenant's campaign id yields nothing", () => {
    expect(members({ restaurantId: REST_B, audience: 'selected', campaignId: CAMPAIGN_SEL })).toEqual([])
  })
})

d('086 resolver — tenant isolation', () => {
  it("a poisoned member_tags row never pulls in another tenant's member", () => {
    expect(named({ restaurantId: REST_A, audience: 'tag', tagIds: [TAG_VIP] })).not.toContain('B1')
  })

  it("another tenant's message rows never change a member's rating", () => {
    // G1 has 50 failed rows written under tenant B; under A it is still green.
    const got = named({ restaurantId: REST_A, audience: 'all', skip: 'red_yellow' })
    expect(got).toContain('G1')
  })

  it("tenant B sees none of A's members, whatever the audience", () => {
    expect(named({ restaurantId: REST_B, audience: 'tag', tagIds: [TAG_VIP] })).toEqual([])
    expect(named({ restaurantId: REST_B, audience: 'all' })).toEqual(['B1'])
  })
})

d('086 resolver — grants (R3)', () => {
  const fns = [
    'campaign_audience_rated(uuid,text,uuid[],uuid[],uuid,int,boolean,text,int,float8,float8)',
    'campaign_audience_members(uuid,text,uuid[],uuid[],uuid,int,boolean,text,int,float8,float8,int,int)',
    'campaign_audience_counts(uuid,text,uuid[],uuid[],uuid,int,boolean,text,int,float8,float8)',
  ]
  it.each(fns)('%s: anon and authenticated cannot execute, service_role can', (fn) => {
    expect(psql(`SELECT has_function_privilege('anon', 'public.${fn}', 'EXECUTE')`)).toBe('f')
    expect(psql(`SELECT has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE')`)).toBe('f')
    expect(psql(`SELECT has_function_privilege('service_role', 'public.${fn}', 'EXECUTE')`)).toBe('t')
  })
})

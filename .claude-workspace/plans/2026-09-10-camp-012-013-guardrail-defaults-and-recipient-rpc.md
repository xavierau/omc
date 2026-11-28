---
id: plans/2026-09-10-camp-012-013-guardrail-defaults-and-recipient-rpc
type: plan
author: solution-architect
created: 2026-09-10
status: active
supersedes: null
superseded_by: null
related: [kanban:CAMP-012, kanban:CAMP-013, github:161, github:162]
---

# Plan: Plan-derived campaign guardrail defaults (#161) + server-side recipient RPCs (#162)

Branch `fix/issues-161-162` (worktree `whatsapp-crm-issues-161-162`, based on origin/develop 8d65e4f).
One PR against develop. Backend only — no UI, no i18n, no feature flags.

## Objective

1. **#161 / CAMP-012** — a tenant can never run on the hardcoded starter quota by accident:
   every `restaurants` row gets a `tenant_campaign_settings` row (trigger + backfill, migration
   078), the in-code fallback derives the limit from `restaurants.plan`, and taking the fallback
   is logged. The monthly limit becomes inclusive (`>` not `>=`).
2. **#162 / CAMP-013** — campaign recipient resolution never ships member UUIDs through a URL
   filter: two set-returning RPCs (migration 079) replace the `member_tags → .in('id', …)` and
   `campaign_members → .in('id', …)` shapes, paged through the existing `readAllPages` helper.
   `MEMBER_ID_CHUNK_SIZE`, `fetchMembersByIds`, `chunk()`, `fetchTaggedMemberIds` go away.

## Context

### Verified against code (issue prescriptions checked, not trusted)

| Claim | Verdict | Where |
|---|---|---|
| `resolveSettings()` silently falls back to `DEFAULT_SETTINGS` | true | `src/application/check-campaign-guardrails.ts:96-102` |
| `DEFAULT_SETTINGS.monthlySendLimit` hardcoded 1000 | true | `src/domain/services/campaign-guardrails.ts:47-65` |
| Only writer of the settings row is `changeTenantPlan` | true for the *quota*; `update-tenant-campaign-settings.ts`, `pause-/resume-tenant-campaigns.ts` also `upsertSettings` (admin hand-edits, pause switch) | `grep upsertSettings src/application` |
| `restaurants.plan` DEFAULT 'starter', CHECK starter/growth/pro | true | `supabase/migrations/017_tenant_plan.sql` |
| Tenant creation seeds nothing | true; `createRestaurant` is the ONLY `restaurants` insert in `src/` + `scripts/` (`onboard-tenant.ts` goes through `createTenant`) | `restaurant-admin-repository.ts:49-63` |
| `checkMonthlyLimit` uses `>=` | true | `campaign-guardrails.ts:72` |
| `getTodayCampaignCount` keyed on `created_at` | true — **and so is `getMonthlyTenantSends`** (`.gte('created_at', startOfMonth)`, line 53); the issue only names the daily one | `campaign-settings-repository.ts:53,79` |
| `fetchSelectedMembers` unchunked + unpaged, `.in('id', memberIds)` at :85 | true | `resolve-campaign-members.ts:69-88` |
| Tag path pages `member_tags` then chunks 500 | true; `readAllPages` ends on the empty page → `ceil(R/1000)+1` requests as stated | `resolve-campaign-members-chunks.ts:43-85` |
| `campaign_members` can be scoped by `restaurant_id` like `member_tags` | **false** — `campaign_members(campaign_id, member_id)` has no `restaurant_id` (migration 015). Tenant scope must go through `campaigns.restaurant_id` | `015_campaign_target_members.sql` |
| Members carry `status` other than active/unsubscribed | false — CHECK `('active','unsubscribed')`; relevant to the `fetchSelectedMembers` status decision below | `001_create_tables.sql:20`, `member.ts:7` |

### Existing tenant_campaign_settings schema (all non-key columns have defaults)

016 base (`monthly_send_limit` DEFAULT 1000, `daily_campaign_limit` 1, `max_unsubscribe_rate`
0.05, `campaign_paused` false, `paused_*` NULL) + 040 `per_user_marketing_cap` 1 + 042
`auto_throttle_factor` 1.00 / `auto_pause_*` + 043 pacing columns + 049
`optin_confirmation_template_id` NULL. `restaurant_id` is `UNIQUE` → `ON CONFLICT (restaurant_id)`
is valid. `updated_at` trigger (016, rebound in 035) fires on UPDATE only — an `INSERT … DO NOTHING`
never touches Kushiro's `updated_at`.

### Precedents to mirror

- **077** `integration_settings_seed_on_create.sql` — AFTER INSERT trigger + idempotent backfill
  (`ON CONFLICT DO NOTHING`), merged 2026-09-10 for the identical bug class.
- **067** `count_active_members_by_tags` — SQL-language STABLE function, both `restaurant_id`
  predicates, `count(DISTINCT m.id)`, 064-style `REVOKE … FROM PUBLIC/anon/authenticated` +
  `GRANT … TO service_role` on the exact signature. Caller precedent
  `tag-audience-repository.ts` + rpc mock precedent `__tests__/tag-audience-repository.test.ts`
  (`{ rpc: vi.fn().mockResolvedValue(...) } as unknown as ReturnType<typeof createServerSupabaseClient>`).
- **Schema-contract test** (INT-001 WI-19):
  `src/infrastructure/supabase/repositories/__tests__/integration-schema-contract.test.ts` +
  `schema-contract/parse-schema.ts` (`MIGRATIONS_DIR = process.cwd()/supabase/migrations`,
  `columnsForTable(table)`). Reuse the "parse the migration SQL statically in vitest" pattern
  for the PLAN_QUOTAS ↔ SQL CASE parity test and the RPC-body contract test.
- **Scratch-DB validation** — memory `project_validate_migrations_on_scratch_db`: build
  `scratch_<n>` on local Postgres 127.0.0.1:54322 with auth/storage/realtime stubs, apply
  001..N-1 with `ON_ERROR_STOP`, run migration N + assertions inside `BEGIN … ROLLBACK`, drop.
  Use `rtk proxy psql`. One assertion per trigger branch + one no-op proving nothing fires.
- **Deploy**: `deploy.sh` on the Forge box runs `npm ci → supabase db push --linked --include-all
  → seed → restart` (camp-008 runbook line 20), so 078/079 apply automatically on release.

### Constraints

- Surgical Changes: `restaurant-repository.ts` (500+ lines) and `resolve-campaign-members.test.ts`
  are existing files — match style, no limits enforced; NEW files/functions: file <150, fn <20, ≤3 params.
- `src/domain` imports nothing from infrastructure. `check-campaign-guardrails.ts` is application
  layer and may import both `planCampaignQuota` (domain VO) and a repository function.
- Dev's FIRST act per WI: author the frozen acceptance tests listed below, commit them, show red.
- Do not touch `execute-campaign.ts:47` (`filter(status !== 'unsubscribed')`) — belt-and-braces stays.
- Do not touch `getTodayCampaignCount` / `getMonthlyTenantSends` keying (follow-up).
- Do not change `kanban.json` (orchestrator).

## Domain Model

No new entities. Touched concepts:

- **TenantPlan** (VO, `tenant-plan.ts`): `starter|growth|pro` → `planCampaignQuota()` is the
  single TS source of truth for the monthly quota. Migration 078 mirrors it in SQL
  (`plan_monthly_send_limit(text)`); parity is enforced by a static test, not by trust.
- **TenantCampaignSettings** (domain type): invariant introduced by this plan — *for every
  `restaurants` row there exists exactly one `tenant_campaign_settings` row, created in the same
  transaction as the restaurant* (trigger). The app-side fallback remains only as defence in depth.
- **Recipient set** (read model): `active_members_by_tags(restaurant, tags)` =
  { m ∈ members | m.restaurant_id = r ∧ m.status='active' ∧ ∃ mt ∈ member_tags: mt.member_id=m.id ∧
  mt.restaurant_id = r ∧ mt.tag_id ∈ tags }, DISTINCT on m.id. Invariant: `|set| =
  count_active_members_by_tags(r, tags)` for all inputs (same FROM/WHERE text).
  `active_members_by_campaign_selection(restaurant, campaign)` = { m | ∃ cm ∈ campaign_members:
  cm.campaign_id = c ∧ campaigns[c].restaurant_id = r ∧ m.id = cm.member_id ∧ m.restaurant_id = r ∧
  m.status='active' }. PK `(campaign_id, member_id)` makes rows unique — no DISTINCT needed.

## Design decisions (open points resolved)

**D1 — UPDATE OF plan on `restaurants` does NOT sync `monthly_send_limit`.** Rationale:
(a) `changeTenantPlan` (the only plan writer reachable from the app) already upserts the quota;
(b) `update-tenant-campaign-settings.ts` lets a platform admin hand-tune `monthly_send_limit`, and
an UPDATE trigger would silently clobber that override on the next plan touch;
(c) the seed's semantics are deliberately "create if absent, never overwrite" (`DO NOTHING`); an
UPDATE-sync is the opposite semantic and would need its own conflict policy. Residual risk: a raw SQL
`UPDATE restaurants SET plan` leaves the quota stale — same as today; documented in the 078 header.

**D2 — `checkMonthlyLimit` becomes `>`**: `currentMonthSends + targetMemberCount > monthlyLimit`
blocks. A 1,000 limit allows exactly 1,000 sends; `1000 + 0` is allowed (nothing to send);
`1 + 1000` blocks. `isApproachingLimit` unchanged.

**D3 — `resolveSettings` fallback fails closed.** If the `restaurants.plan` read throws, the
guardrail check throws (campaign fails) — identical to today's behaviour when
`getSettingsForTenant` throws. A guardrail that degrades to "allow" on DB error is worse than a
failed send. A missing restaurant row (`null`) is treated as `starter` and warned.

**D4 — `fetchSelectedMembers` RPC filters `m.status = 'active'`.** Observable behaviour is
unchanged: `members.status ∈ {active, unsubscribed}` (001 CHECK) and `execute-campaign.ts:47`
already drops `unsubscribed` before the guardrail count, so the recipient set and
`activeMembers.length` are identical. Benefits: both RPCs are symmetric, no unsubscribed-member
PII is shipped to the worker, and `:47` stays as defence in depth. No documented reason to keep
sending unsubscribed rows to the worker was found (`grep` shows `resolveTargetMembers` has one
caller). Recorded in the 079 header.

**D5 — Two migrations: 078 (#161, trigger + data-changing backfill) and 079 (#162, DDL-only RPCs).**
078 changes data and is the one to inspect on prod after deploy; 079 is pure functions. Separate
files keep the scratch validations and any rollback independent and match the one-concern-per-file
history (064, 067, 077).

**D6 — SQL helper `plan_monthly_send_limit(p_plan text) RETURNS integer IMMUTABLE`** holds the
CASE once; trigger and backfill both call it. Not locked down: it reads no data (a pure CASE) and
the 064 lockdown exists to protect data-touching RPCs; revoking EXECUTE would also make the trigger
fail for any non-service-role inserter in the future. Trigger function mirrors 077 exactly (plain
plpgsql, not SECURITY DEFINER) — the only `restaurants` inserter today is the service-role client.

**D7 — Paging = `p_limit`/`p_offset` through `readAllPages`** (`p_limit = to - from + 1`,
`p_offset = from`). The helper's contract (stop on empty page, advance by rows received) still holds
if the project's PostgREST `max-rows` is below `READ_PAGE_SIZE`; `ORDER BY m.id` in the RPC is the
total order that makes offsets stable. `supabase.rpc()` returns a thenable builder →
satisfies `PromiseLike<PageResult<T>>` without adapters.

**D8 — `MEMBER_COLUMNS` becomes an exported const** so the RPC contract test can assert the
`RETURNS TABLE` column list equals the columns `mapRowToMember` consumes. Tiny, traceable change.

## Subtasks

### WI-1 — #161 plan-derived guardrail defaults (senior-backend-dev)

Depends on: nothing. Files: `supabase/migrations/078_tenant_campaign_settings_seed_on_create.sql`
(new), `src/domain/services/campaign-guardrails.ts`, `src/application/check-campaign-guardrails.ts`,
`src/infrastructure/supabase/repositories/restaurant-repository.ts`, tests listed below.

**Migration 078** (header explains #161, D1, D6; cites 077 as the pattern):
1. `CREATE OR REPLACE FUNCTION public.plan_monthly_send_limit(p_plan text) RETURNS integer`
   `LANGUAGE sql IMMUTABLE` — `CASE p_plan WHEN 'starter' THEN 1000 WHEN 'growth' THEN 10000
   WHEN 'pro' THEN 100000 ELSE 1000 END`. Numbers MUST match `PLAN_QUOTAS` (parity test below).
2. `CREATE OR REPLACE FUNCTION restaurant_seed_campaign_settings() RETURNS TRIGGER` —
   `INSERT INTO tenant_campaign_settings (restaurant_id, monthly_send_limit) VALUES (NEW.id,
   plan_monthly_send_limit(NEW.plan)) ON CONFLICT (restaurant_id) DO NOTHING; RETURN NEW;`
3. `CREATE TRIGGER trg_restaurant_seed_campaign_settings AFTER INSERT ON restaurants FOR EACH ROW …`
4. Backfill: `INSERT INTO tenant_campaign_settings (restaurant_id, monthly_send_limit) SELECT id,
   plan_monthly_send_limit(plan) FROM restaurants ON CONFLICT (restaurant_id) DO NOTHING;`
   (Kushiro's existing `growth` row is untouched by construction.)

**TS changes**:
- `restaurant-repository.ts`: add `getRestaurantPlan(restaurantId): Promise<TenantPlan | null>`
  next to `getRestaurantTenantStatus` (same shape: `.select('plan').eq('id', …).maybeSingle()`,
  throw on error, `null` when no row, `isValidPlan` guard → `'starter'` if the value is somehow
  outside the CHECK set).
- `check-campaign-guardrails.ts` `resolveSettings`: on `null` row → `plan = (await
  getRestaurantPlan(id)) ?? 'starter'`, `limit = planCampaignQuota(plan)`,
  `console.warn('[Guardrails] tenant_campaign_settings missing for tenant <id>; using plan-derived
  defaults (plan=<plan>, monthlySendLimit=<limit>) — migration 078 should have seeded this row')`,
  return `{ restaurantId, ...DEFAULT_SETTINGS, monthlySendLimit: limit }`. Keep under 20 lines
  (extract `planDerivedDefaults(id)` if needed).
- `campaign-guardrails.ts` `checkMonthlyLimit`: `>=` → `>` (D2). `DEFAULT_SETTINGS` keeps
  `monthlySendLimit: 1000` (it IS the starter value; parity asserted by test).

**Frozen acceptance tests (author first, show red, then implement)**:

| # | Test file | Assertion |
|---|---|---|
| A1 | `src/domain/services/__tests__/campaign-guardrails.test.ts` | `checkMonthlyLimit(0, 1000, 1000).allowed === true`; `(1, 1000, 1000)` blocked; `(1000, 0, 1000)` allowed (rewrite the existing "already at limit with target=0 → blocked" case to the new inclusive shape — rewritten, not deleted); property: for all `s,t,L ≥ 0`, `allowed ⇔ s + t ≤ L` (vitest `it.each` over a grid incl. boundaries) |
| A2 | `src/domain/value-objects/__tests__/tenant-plan.test.ts` | `DEFAULT_SETTINGS.monthlySendLimit === planCampaignQuota('starter')` (ties the constant to the VO) |
| A3 | `src/application/__tests__/check-campaign-guardrails.test.ts` | rewrite "uses default settings when no tenant settings exist": mock `getRestaurantPlan` → `'growth'`, settings `null`, monthlySends 5000, target 4000 → `allowed === true`, `usage.monthlyLimit === 10000`; `console.warn` called once with a string containing the tenant id, `plan=growth` and `monthlySendLimit=10000` |
| A4 | same | settings `null`, `getRestaurantPlan` → `null` → limit 1000, warn contains `plan=starter` |
| A5 | same | settings row present → `getRestaurantPlan` NOT called, `console.warn` NOT called (fast path untouched) |
| A6 | same | `getRestaurantPlan` rejects → `checkCampaignGuardrails` rejects (D3 fail-closed) |
| A7 | `restaurant-repository` test (existing file if present, else new `__tests__/restaurant-repository.plan.test.ts`) | `getRestaurantPlan` selects `plan` by `id`, returns `'pro'`; returns `null` on no row; throws on error; coerces an invalid value to `'starter'` |
| A8 | NEW `src/infrastructure/supabase/repositories/__tests__/plan-quota-migration-contract.test.ts` | reads `supabase/migrations/078_*.sql` (glob by prefix, exactly one match); regex `WHEN\s+'(\w+)'\s+THEN\s+(\d+)` inside `plan_monthly_send_limit` → map; for every plan in `['starter','growth','pro']` map[plan] `=== planCampaignQuota(plan)`; map has no extra keys; `ELSE (\d+)` `=== planCampaignQuota('starter')` |
| A9 | same file | 078 contains `AFTER INSERT ON restaurants`, `ON CONFLICT (restaurant_id) DO NOTHING` (twice: trigger + backfill), and the backfill `SELECT … FROM restaurants`; the trigger's INSERT column list ⊆ `columnsForTable('tenant_campaign_settings')` (reuse `parse-schema.ts`; if `columnsForTable` does not fold `ALTER TABLE … ADD COLUMN`, assert against the 016 base columns only and say so in a comment) |
| A10 | `src/application/__tests__/enforce-campaign-guardrails.test.ts`, `change-tenant-plan.test.ts` | run unchanged and green (regression guard; if any encodes the `>=` boundary, rewrite to `>`) |

Scratch-DB validation (dev runs before opening the PR; paste RETURNING rows into the handoff artifact):
build `scratch_078` from 001..077, then inside `BEGIN … ROLLBACK`:
1. Pre-078 setup: insert restaurants S (plan default), G (`growth`), P (`pro`), K (`growth`) + a
   hand-made settings row for K (`monthly_send_limit 10000, daily_campaign_limit 5`) — K simulates
   Kushiro; capture K's `updated_at`.
2. Apply 078. Assert: S→1000, G→10000, P→100000; K row unchanged (limit 10000, daily 5, same
   `updated_at`); `count(restaurants) = count(tenant_campaign_settings)`.
3. Trigger branch: insert N (`pro`) → row with 100000 exists in the same txn; insert D (no plan
   column) → 1000.
4. Idempotency: re-run the backfill statement → 0 rows inserted, K still unchanged.
5. No-op branch (D1): `UPDATE restaurants SET plan='pro' WHERE id = S` → S's settings still 1000.
6. `SELECT plan_monthly_send_limit(x)` for the three plans and an unknown string → 1000/10000/100000/1000.

Acceptance: A1–A10 green; scratch steps 1–6 pass; `npm run gate` green; no orphaned imports.

### WI-2 — #162 recipient resolution via set-returning RPCs (senior-backend-dev)

Depends on: WI-1 merged into the branch first only for migration numbering (079 after 078); code is independent.
Files: `supabase/migrations/079_active_members_rpcs.sql` (new), `src/application/resolve-campaign-members.ts`,
`src/application/resolve-campaign-members-chunks.ts`, tests listed below.

**Migration 079** (header: #162, cites 067 + 064, records D4, D7, explains why the selection RPC
scopes through `campaigns.restaurant_id`):
1. `public.active_members_by_tags(p_restaurant_id uuid, p_tag_ids uuid[], p_limit int DEFAULT NULL,
   p_offset int DEFAULT 0) RETURNS TABLE (id uuid, restaurant_id uuid, phone text, name text,
   points_balance int, status text, joined_at timestamptz, last_visit_at timestamptz,
   preferred_language text, pmm_throttled_until timestamptz, unreachable_at timestamptz)` —
   body exactly as the issue proposes: `SELECT DISTINCT ON (m.id) m.<cols> FROM member_tags mt
   JOIN members m ON m.id = mt.member_id WHERE mt.restaurant_id = p_restaurant_id AND
   m.restaurant_id = p_restaurant_id AND m.status = 'active' AND mt.tag_id = ANY(p_tag_ids)
   ORDER BY m.id LIMIT p_limit OFFSET p_offset;` `LANGUAGE sql STABLE`. The WHERE text must be
   character-identical to 067's so the count/send parity is structural (contract test B9 checks it).
   Dev verifies the declared column types against the migrations (`columnsForTable('members')`
   for names; types from 001 + the migrations that added `preferred_language`,
   `pmm_throttled_until`, `unreachable_at`) — a mismatch fails at `CREATE FUNCTION` time on the scratch DB.
2. `public.active_members_by_campaign_selection(p_restaurant_id uuid, p_campaign_id uuid,
   p_limit int DEFAULT NULL, p_offset int DEFAULT 0) RETURNS TABLE (same columns)` —
   `SELECT m.<cols> FROM campaign_members cm JOIN campaigns c ON c.id = cm.campaign_id JOIN members m
   ON m.id = cm.member_id WHERE cm.campaign_id = p_campaign_id AND c.restaurant_id = p_restaurant_id
   AND m.restaurant_id = p_restaurant_id AND m.status = 'active' ORDER BY m.id LIMIT p_limit OFFSET
   p_offset;` No DISTINCT (PK `(campaign_id, member_id)`); comment says so.
3. 064 lockdown for BOTH, on the exact 4-arg signatures: `REVOKE EXECUTE … FROM PUBLIC; FROM anon;
   FROM authenticated; GRANT EXECUTE … TO service_role;`

**TS changes** (`resolve-campaign-members.ts`):
- `export const MEMBER_COLUMNS` (D8).
- `fetchTagMembers(campaign, restaurantId)`: `tagIds = await getCampaignTagIds(campaign.id)`;
  `[]` if none; `rows = await readAllPages<Record<string, unknown>>('fetchTagMembers', (from, to) =>
  supabase.rpc('active_members_by_tags', { p_restaurant_id: restaurantId, p_tag_ids: tagIds,
  p_limit: to - from + 1, p_offset: from }))`; `rows.map(mapRowToMember)`.
- `fetchSelectedMembers(campaignId, restaurantId)`: same with
  `active_members_by_campaign_selection` + `p_campaign_id`. Label `'fetchSelectedMembers'`.
- Delete `MEMBER_ID_CHUNK_SIZE`, `fetchMembersByIds`, the `chunk`/`fetchTaggedMemberIds` import;
  import `readAllPages` instead. Update the branch comment (it currently says "mirrors the two-step
  fetchSelectedMembers shape").
- `resolve-campaign-members-chunks.ts`: delete `chunk()` and `fetchTaggedMemberIds` (grep confirmed
  their only importer is `resolve-campaign-members.ts`); keep `READ_PAGE_SIZE`, `readAllPages`;
  update the header doc comment (it describes `chunk()`). Filename rename is optional churn —
  leave it unless the reviewer asks (flag in handoff).
- Optional, only if `resolve-campaign-members.ts` exceeds 150 lines after the edit (it should
  shrink): nothing else.

**Frozen acceptance tests (author first, show red)** — rewrite `src/application/__tests__/resolve-campaign-members.test.ts`
to the new shape (rewritten, never deleted; the promo/winback/birthday/mapping tests stay as-is):

Mock setup: `createServerSupabaseClient: vi.fn(() => ({ from: mockFrom, rpc: mockRpc }))`.
Helper `pagingRpc(rows, maxRows = Infinity)` mirroring today's `pagingRange`: records
`{ name, args }` per call, returns `rows.slice(args.p_offset, args.p_offset + min(args.p_limit, maxRows))`
so the loop's empty page is produced like PostgREST would.

| # | Assertion |
|---|---|
| B1 | tag branch: `campaign_tags` still read via `from()`; `mockRpc` called with `('active_members_by_tags', { p_restaurant_id: 'r-1', p_tag_ids: ['t-1'], p_limit: 1000, p_offset: 0 })`; `mockFrom` never called with `'member_tags'` or `'members'`; result mapped to `Member` |
| B2 | selected branch: `mockRpc` called with `('active_members_by_campaign_selection', { p_restaurant_id: 'r-1', p_campaign_id: 'camp-1', p_limit: 1000, p_offset: 0 })`; `mockFrom` never called at all |
| B3 | invariant "no member UUID leaves the process": for both branches, `JSON.stringify(mockRpc.mock.calls)` contains no member id from the returned rows and `mockFrom` is never called with `'members'` |
| B4 | paging 1,200 rows (tag) → `p_offset` sequence `[0, 1000, 1200]`, 1,200 unique ids returned; same for selected branch |
| B5 | paging 2,500 rows → `[0, 1000, 2000, 2500]`; exact multiple 1,000 → `[0, 1000]`; `maxRows = 500` with 1,200 rows → `[0, 500, 1000, 1200]` (readAllPages contract preserved through the RPC) |
| B6 | no linked tags → rpc not called; tag with 0 members → rpc called once, `[]`; empty `campaign_members` → `[]` |
| B7 | rpc error → rejects with `fetchTagMembers: <msg>` / `fetchSelectedMembers: <msg>` |
| B8 | dynamic membership test retained (rpc returns `m-2`); cross-tenant test retained as "passes `p_restaurant_id` = caller's tenant" (the SQL-side leak proof lives in scratch step 4 below) |
| B9 | NEW `src/infrastructure/supabase/repositories/__tests__/recipient-rpc-migration-contract.test.ts`: reads `079_*.sql`; for each of the two function names asserts: `RETURNS TABLE (…)` column names `=== MEMBER_COLUMNS.split(', ')` in order; body contains `m.restaurant_id = p_restaurant_id`, `m.status = 'active'`, `ORDER BY m.id`, `LIMIT p_limit OFFSET p_offset`; tags fn contains `mt.restaurant_id = p_restaurant_id` and `mt.tag_id = ANY(p_tag_ids)`; selection fn contains `c.restaurant_id = p_restaurant_id` and `cm.campaign_id = p_campaign_id`; the tags fn's normalised WHERE clause equals 067's (`067_*.sql`) WHERE clause — structural count/send parity; both signatures have 3 REVOKEs (PUBLIC, anon, authenticated) + 1 GRANT service_role; `STABLE` |
| B10 | `src/application/__tests__/execute-campaign.test.ts` unchanged and green (it mocks `resolveTargetMembers` wholesale) |

Scratch-DB validation (`scratch_079` from 001..078; inside `BEGIN … ROLLBACK`):
1. Fixtures: restaurants A, B; members a1, a2 (active, A), a3 (unsubscribed, A), b1 (active, B);
   tags tA1, tA2 (A), tB1 (B); member_tags: (a1,tA1), (a1,tA2), (a2,tA1), (a3,tA1), **poison-1**
   `(member b1, tag tA1, restaurant_id A)`, **poison-2** `(member a1, tag tA1, restaurant_id B)`.
   Campaign cA (A, target 'selected') with campaign_members a1, a3, b1.
2. Parity: for each non-empty subset of {tA1, tA2}: `(SELECT count(*) FROM active_members_by_tags(A, subset))
   = count_active_members_by_tags(A, subset)` (3 subsets).
3. Dedupe: a1 appears exactly once for `{tA1, tA2}`; result for `{tA1,tA2}` = {a1, a2}.
4. Cross-tenant: b1 absent from every A result (poison-1 killed by `m.restaurant_id`); calling with
   `p_restaurant_id = B, tags {tA1}` returns 0 rows (poison-2 killed by `mt.restaurant_id`).
5. Status: a3 absent from both RPCs.
6. Paging: `(limit 1, offset 0) ∪ (limit 1, offset 1)` = full set, disjoint; `(limit NULL)` = full set;
   `offset ≥ |set|` → 0 rows.
7. Selection: `active_members_by_campaign_selection(A, cA)` = {a1}; `(B, cA)` = 0 rows.
8. Lockdown: `SET ROLE authenticated; SELECT * FROM active_members_by_tags(…)` → permission denied;
   same for `anon`; `SET ROLE service_role` → rows. Both functions.
9. `EXPLAIN` the tags query once with a few thousand fixture rows only if cheap — informational.

Look-only audit (report in handoff; NO fixes in this PR) — pre-answered here, dev confirms:
- `src/infrastructure/supabase/repositories/member-tag-bulk.ts:21` `assertMembersBelongToTenant`
  `.in('id', memberIds)` — input = member ids from the members-list bulk tag/untag route body; a
  bulk selection above ~390 ids hits the same header overflow (500 to the merchant). `deleteMemberTagsBulk`
  below it uses the same `.in()` shape. Not verified on prod (input size unknown). Same-class follow-up.
- `campaign-members-repository.ts:41` `assertMembersBelongToTenant` — a second copy of the same
  function (DRY smell, mention only); input = `memberIds` of a 'selected' campaign on create/update
  → creating a selected campaign with >~390 members fails with `fetch failed`. Same-class follow-up.
- `integration-event-repository.ts:87` `findIntegrationEventsByIds` `.in('id', ids)` — ids are the
  distinct `eventId`s of one deliveries page; `list-integration-deliveries.ts` caps `limit` at
  `MAX_PAGE_SIZE = 500` > ~390, so `GET …/deliveries?limit=500` can overflow; default 50 is safe.
  Follow-up: cap ≤ 350 or POST/RPC.

Acceptance: B1–B10 green; scratch steps 1–8 pass; `npm run gate` green; `grep -rn "MEMBER_ID_CHUNK_SIZE\|fetchMembersByIds\|fetchTaggedMemberIds\|chunk(" src` → 0 hits outside unrelated modules.

### WI-3 — Integration (senior-backend-dev; small — the orchestrator may fold it into WI-2's dispatch)

Depends on: WI-1, WI-2.
1. Rebuild ONE scratch DB from 001..077, apply 078 then 079 in order (proves numbering + ordering),
   re-run WI-1 steps 2–3 and WI-2 steps 2–8 in one `BEGIN … ROLLBACK`.
2. Full `npm run gate` (typecheck · lint · coverage) on the merged branch; full vitest run
   (the WAQ webhook integration tests are known-flaky in the full suite — memory
   `project_flaky_webhook_integration_tests`; re-run in isolation before calling them red).
3. Walk the Integration Map below and tick every row.
4. End-to-end proof from the entry point (worker path): in `execute-campaign.test.ts` nothing
   changes; the proof is the scratch-DB run + B1/B2 (worker → `resolveTargetMembers` → rpc) +
   A3 (guardrail → plan-derived limit). Record in the handoff that the browser cannot exercise
   this (backend-only; DEV Supabase lacks the schema — memory `incident_no_browser_env_for_db_features`).
5. Write `artifacts/2026-09-10-camp-012-013-backend.md` (implementation note: files, tests count,
   scratch RETURNING rows, audit findings) and register it in INDEX.md.

## Integration Map

| # | Registration point | WI |
|---|---|---|
| I-1 | `supabase/migrations/078_tenant_campaign_settings_seed_on_create.sql` — helper fn, trigger fn, trigger, backfill | WI-1 |
| I-2 | `supabase/migrations/079_active_members_rpcs.sql` — 2 RPCs + 3 REVOKE / 1 GRANT each | WI-2 |
| I-3 | `restaurant-repository.ts` `getRestaurantPlan` export | WI-1 |
| I-4 | `check-campaign-guardrails.ts` `resolveSettings` → plan-derived fallback + warn | WI-1 |
| I-5 | `campaign-guardrails.ts` `checkMonthlyLimit` `>` | WI-1 |
| I-6 | `resolve-campaign-members.ts` — `fetchTagMembers`, `fetchSelectedMembers` → rpc + `readAllPages`; `MEMBER_COLUMNS` exported; chunk path removed | WI-2 |
| I-7 | `resolve-campaign-members-chunks.ts` — `chunk`, `fetchTaggedMemberIds` deleted; doc comment updated | WI-2 |
| I-8 | Tests rewritten: `campaign-guardrails.test.ts`, `check-campaign-guardrails.test.ts`, `resolve-campaign-members.test.ts` | WI-1 / WI-2 |
| I-9 | Tests new: `plan-quota-migration-contract.test.ts`, `recipient-rpc-migration-contract.test.ts`, `getRestaurantPlan` tests | WI-1 / WI-2 |
| I-10 | Regression: `enforce-campaign-guardrails.test.ts`, `change-tenant-plan.test.ts`, `execute-campaign.test.ts`, `tag-audience-repository.test.ts` green | WI-3 |
| I-11 | Deploy: `deploy.sh` `supabase db push --linked --include-all` applies 078+079 — no new env vars, no Forge job, no seed change | WI-3 (release notes) |
| I-12 | **Corrected post-review (gstack F2):** `app/api/admin/tenants/[id]/campaign-settings/route.ts` GET IS a second null-settings fallback and now calls the exported `planDerivedDefaults`. Nav, i18n, feature flags, DI bindings, permissions: not applicable (verified); kanban (orchestrator) | WI-1 |

## Acceptance Criteria

#161 (the issue's four fixes + decisions):
- [ ] Every `restaurants` row has a `tenant_campaign_settings` row after 078 (scratch: counts equal; prod: LEFT JOIN null-check = 0).
- [ ] A new restaurant gets its row in the same transaction with `monthly_send_limit = planCampaignQuota(plan)` (trigger).
- [ ] Backfill is idempotent and leaves pre-existing rows (Kushiro) byte-identical incl. `updated_at`.
- [ ] `resolveSettings` with no row returns `planCampaignQuota(restaurants.plan)` and emits one `console.warn` naming the tenant, the plan and the limit; with a row it does neither.
- [ ] `checkMonthlyLimit` allows `sends + target ≤ limit` (inclusive), blocks above.
- [ ] `PLAN_QUOTAS` ↔ `plan_monthly_send_limit` parity is a test, red on drift.

#162 (issue checklist verbatim + additions):
- [ ] Tag-targeted send resolves in one RPC call per page; no member UUID appears in a request URL.
- [ ] A >1,000-recipient tag campaign resolves completely (no silent `max-rows` truncation) and sends.
- [ ] `active_members_by_tags` recipient set size equals `count_active_members_by_tags` for the same inputs — count and send cannot diverge.
- [ ] Cross-tenant test: a `member_tags` row with a mismatched `restaurant_id` yields no recipient.
- [ ] A member carrying two selected tags receives exactly one message.
- [ ] `fetchSelectedMembers` converted the same way.
- [ ] `MEMBER_ID_CHUNK_SIZE` and the tag-path `chunk()` usage removed rather than retuned.
- [ ] Existing tests encoding the old shape are rewritten to the new shape, not deleted.
- [ ] Both RPCs locked down (REVOKE PUBLIC/anon/authenticated, GRANT service_role) — proven on the scratch DB with `SET ROLE`.
- [ ] Audit of the three `.in()` sites reported in the handoff, no fixes shipped.

Whole PR:
- [ ] Feature reachable end-to-end from the entry point: worker `executeCampaign` → `resolveTargetMembers` → RPC (B1/B2 + scratch), and `enforceCampaignGuardrails` → plan-derived limit (A3); prod smoke per Release notes.
- [ ] `npm run gate` green; no test weakened (diff the suite).

## Performance Budgets

- Recipient resolution, tag audience of N active members: `≤ ceil(N/1000) + 1` RPC round trips
  (11 for 10,000; was 32 and failing), response header per page constant (< 2 KB — measured 872 B
  for the 067 RPC), wall time ≤ 5 s for N = 10,000 on prod. Selected audience: same bound.
- Guardrail check: +0 queries on the normal path (row exists); +1 `restaurants.plan` read only on
  the fallback path, which is empty after the 078 backfill.
- Migration 078: one INSERT … SELECT over `restaurants` (tens of rows) — sub-second. 079: DDL only.
- No UI, so no page-load budget ("none" justified: backend-only change).

## Release notes (for the runbook; devops/orchestrator)

- Migrations 078 and 079 apply on deploy via `deploy.sh` → `supabase db push --linked --include-all`.
  **078 is data-changing** (backfill). Record BEFORE deploy: Kushiro
  (`96676002-4ba4-46cc-966c-061adc5d26f1`) `tenant_campaign_settings` row (`monthly_send_limit`,
  `daily_campaign_limit`, `updated_at`) and `SELECT count(*) FROM tenant_campaign_settings` (expected 1).
- AFTER deploy, on prod (service-role, read-only):
  1. `SELECT count(*) FROM restaurants r LEFT JOIN tenant_campaign_settings s ON s.restaurant_id = r.id WHERE s.id IS NULL` → 0.
  2. Kushiro row unchanged vs the pre-deploy capture (limit 10000, same `updated_at`).
  3. `SELECT r.plan, s.monthly_send_limit, count(*) FROM restaurants r JOIN tenant_campaign_settings s ON … GROUP BY 1,2` → every `(plan, limit)` pair matches `PLAN_QUOTAS`; any other pair is a hand-edited quota (expected only for Kushiro).
  4. RPC smoke (the incident-memory rule: one real-PostgREST probe per new function):
     `POST /rest/v1/rpc/active_members_by_tags` with the service key for Kushiro's live tag audience
     (744 members on 2026-09-10) → 744 rows across pages, response header < 2 KB; same call with
     the anon key → 401/permission denied. Same pair for `active_members_by_campaign_selection`
     with a zero UUID campaign → `200 []` / denied.
  5. Worker logs: zero `[Guardrails] tenant_campaign_settings missing` lines after deploy; any hit
     names a tenant whose row was deleted — investigate, do not ignore.
- Re-running Kushiro's terminally failed "5 year batch 6" is a tenant/business action (a new
  campaign), not part of this release — surface to the user.
- Rollback: 079 is drop-safe (`DROP FUNCTION` ×2; the old TS path is gone, so roll back the app
  build too). 078: dropping the trigger is safe; the backfilled rows are correct data and should stay.

## Out of Scope

- `getTodayCampaignCount` and `getMonthlyTenantSends` keying on `campaigns.created_at` instead of
  send time (`campaign-settings-repository.ts:53,79`).
- Fixing the three audited `.in()` sites (`member-tag-bulk.ts:21`, `campaign-members-repository.ts:41`,
  `integration-event-repository.ts:87`) and the duplicated `assertMembersBelongToTenant`.
- UPDATE-of-plan sync trigger (D1). Any UI for quotas. Renaming `resolve-campaign-members-chunks.ts`.
- Kanban updates (orchestrator). Re-sending the failed Kushiro campaign.

## Follow-ups (file as issues after merge)

1. **#161 keying**: monthly and daily guardrail counters use `campaigns.created_at`; a campaign
   created Monday and sent Friday consumes Monday's allowance, and last month's scheduled campaign
   sent this month counts against last month. Key on send time (`sending`/`completed` timestamp) —
   needs a column or `started_at`; separate design.
2. **#162 audit results**: three same-shape `.in('id', ids)` sites remain (see WI-2 audit). Two are
   request-sized (bulk tag route, selected-campaign create/update) and will 500 above ~390 ids;
   one (`findIntegrationEventsByIds`) overflows only at `limit=500`. Proposed: a generic
   `members_in_tenant(p_restaurant_id, p_member_ids uuid[]) RETURNS setof uuid` RPC for the two
   tenant assertions (ids travel in the POST body), and a cap or RPC for the deliveries lookup.
   `assertMembersBelongToTenant` exists twice — dedupe when touching.

## Risks & Open Questions

- **Assumption (unanswerable now)**: no non-service-role path inserts into `restaurants`. If one
  appears, the plain (non-SECURITY DEFINER) trigger's INSERT into `tenant_campaign_settings` runs
  under the inserter's RLS (`campaign_settings_insert WITH CHECK (is_platform_admin())`). Mirrors
  077's choice; revisit if a dashboard-side tenant creation is ever added.
- **Column types in `RETURNS TABLE`**: the issue's list is asserted at `CREATE FUNCTION` time on the
  scratch DB (a wrong type errors there, not on prod). Dev must not skip the scratch run.
- **Offset paging under concurrent writes**: a member flipping status between pages can shift
  rows by one — identical exposure to today's `.range()` walk; accepted.
- **PostgREST `max-rows` applies to RPC results too**: handled by `readAllPages` advancing by rows
  received (B5 proves it).
- **INDEX.md entry exceeds the 150-char budget** because the mandated artifact id is 57 chars;
  the hook may flag it — reported, not worked around.
- **Test-only export** of `MEMBER_COLUMNS` (D8) — small API surface increase; reviewer may prefer
  the contract test to duplicate the list. Either is acceptable; the plan prefers one source of truth.

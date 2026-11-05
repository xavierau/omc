---
id: artifacts/2026-09-10-camp-012-013-review-fixes-backend
type: artifact
author: senior-backend-dev
created: 2026-09-10
status: active
supersedes: null
superseded_by: null
related:
  - reviews/2026-09-10-camp-012-013-analyzer
  - reviews/2026-09-10-camp-012-013-grok
  - plans/2026-09-10-camp-012-013-guardrail-defaults-and-recipient-rpc
  - artifacts/2026-09-10-camp-012-guardrail-defaults-backend
  - artifacts/2026-09-10-camp-013-recipient-rpc-backend
  - artifacts/2026-09-10-camp-012-013-integration-note
  - github:161
  - github:162
  - kanban:CAMP-012
  - kanban:CAMP-013
---

# Review fixes: CAMP-012 / CAMP-013 (#161 / #162)

Cold fix round on `fix/issues-161-162`, starting from `2e93cd39` (the tree both
reviewers read). Six in-scope findings from
`reviews/2026-09-10-camp-012-013-analyzer` and
`reviews/2026-09-10-camp-012-013-grok`. Final **code** SHA **`4766636c`**
(this note is the only commit on top of it).

## Per-finding disposition

| Finding | Verdict | What was done |
|---|---|---|
| **Analyzer I-1** — cross-page duplicate recipients | **Valid, fixed** | `dedupeById()` in `resolve-campaign-members-chunks.ts`, applied to both RPC branches. Failing test first (`1313d902`), fix second (`1a07dd3c`). |
| **Analyzer I-2** — 078 contract test blind to trigger↔CASE drift | **Valid, fixed** | Two assertions tying the trigger body to `plan_monthly_send_limit(NEW.plan)` and the backfill to `plan_monthly_send_limit(plan)`, each scoped to its own statement. |
| **Grok Important (a)** — SQL properties asserted only against a mock | **Valid, fixed** | New `recipient-rpcs.db.test.ts` (15 assertions) run against real Postgres. |
| **Grok Important (b)** — three mock-blind unit tests | **Valid, fixed** | Rewritten to claim only what the mock proves. 6 assertions → 11. |
| **Grok Minor** — `check-campaign-guardrails.test.ts:163` | **Valid, fixed** | Plan pinned to `'starter'`, `console.warn` spied + silenced, warning asserted once and named to the tenant. |
| **Analyzer M-1** — 078 header over-claims idempotency | **Valid, fixed** | `DROP TRIGGER IF EXISTS trg_restaurant_seed_campaign_settings ON restaurants;` added; nothing else in the file touched. |
| **Analyzer M-4** — 079 contract test whitespace-coupled | **Valid, fixed** | `normalised()` applied to every `toContain`; the predicates stay exact. |
| Analyzer I-3, M-2, M-3, M-5, M-6, create-path cap | **Out of scope by brief** | Reported to the user / follow-ups. No code change. |

No finding was judged wrong. Nothing was weakened or deleted to make a build
green; the only test rewritten *down* in claim (Grok Important b) was rewritten
*up* in assertion count, and the three original claims now live in the DB test
where they can actually fail.

## Files Changed

| File | Lines | Purpose |
|---|---|---|
| `src/application/resolve-campaign-members-chunks.ts` | +24 | `dedupeById()` — keeps the first occurrence of each id across the whole page walk (I-1) |
| `src/application/resolve-campaign-members.ts` | ±3 | both RPC branches route through `dedupeById` |
| `src/application/__tests__/resolve-campaign-members.test.ts` | +111 / -22 | `scriptedPagesRpc` + 2 overlap regressions (I-1); 3 mock-blind tests rewritten (Grok) |
| `src/application/__tests__/check-campaign-guardrails.test.ts` | +17 / -3 | no-settings case pins the plan and asserts the fallback warning (Grok Minor) |
| `src/infrastructure/supabase/__tests__/recipient-rpcs.db.test.ts` | +229 (new) | real-Postgres proof of 079's isolation / dedupe / status / 067 parity / campaign scoping |
| `src/infrastructure/supabase/repositories/__tests__/plan-quota-migration-contract.test.ts` | +40 | trigger + backfill must call `plan_monthly_send_limit` (I-2) |
| `src/infrastructure/supabase/repositories/__tests__/recipient-rpc-migration-contract.test.ts` | +30 / -10 | whitespace-tolerant substring assertions (M-4) |
| `supabase/migrations/078_tenant_campaign_settings_seed_on_create.sql` | +1 | `DROP TRIGGER IF EXISTS` (M-1) |

## Key Decisions

**1. `dedupeById` lives in the paging module, not the recipient module.**
Cross-page dedupe is a property of an OFFSET walk, not of campaigns, and the
module already owns the "why this walk is shaped like this" comment block.
`resolve-campaign-members.ts` also sits at 135 lines; the helper would have
pushed the comment that explains it past the 150-line budget. Dedupe happens
after mapping (`Member.id` is typed) and keeps first-seen order.

The durable alternative the analyzer offered — keyset paging (`p_after uuid`)
— was **not** taken: it changes migration 079's signature and `readAllPages`'
contract, which is a plan-sized change, not a review fix. The skip that offset
paging can still produce under concurrent inserts is unchanged from the
pre-#162 behaviour and was accepted in the plan; only the *new* duplicate is
closed here.

**2. The DB test connects through `psql`, not supabase-js.** The two committed
precedents (`stamp-rpc.db.test.ts`, `coupon-claim-idempotency.db.test.ts`) use
`createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)` — i.e.
PostgREST. No PostgREST fronts a scratch database (the local stack's REST
endpoint serves an unrelated project's `postgres` DB), and the repo has no `pg`
driver, so following that precedent literally would have produced another
*authored-but-unrunnable* file — which is what both precedents admit to being
in their own headers, and the opposite of what this finding asked for.
Deviation taken deliberately: the **gating convention is followed exactly**
(`RUN_DB_TESTS === '1'`, `const d = RUN ? describe : describe.skip`, skips
clean in `npm test`), and the connection is `execFileSync('psql', …)` driven by
the standard libpq env vars. `PGDATABASE` defaults to `scratch_camp_fix` — a
name that does not normally exist — so a misfire fails loudly instead of
seeding fixtures into a real database. Adding `pg` as a devDependency was
rejected: it is outside the dispatch boundary and buys nothing these SQL-level
assertions need.

**3. M-1 fixed by making the claim true, not by softening it.** The header's
"re-running this migration is a no-op the second time" is now accurate.
M-3 (`SET search_path`) was explicitly out of scope and is NOT included, even
though the analyzer offered it as a freebie "if you touch the file".

**4. Every fix is proven by mutation, not by assertion count.** Three negative
controls, all run:

- **I-2**: replacing both `plan_monthly_send_limit` call sites with the literal
  `1000` fails exactly the two new assertions — and leaves all 9 pre-existing
  ones green, which is the hole the analyzer described.
- **M-4**: reformatting 079's predicates 067-style (`m.restaurant_id  =  p_restaurant_id`,
  `ORDER BY` on its own line) turned **5** assertions red against the pre-fix
  test file and **0** against the fixed one.
- **Grok Important**: a `active_members_by_tags` that drops `mt.restaurant_id`
  and `DISTINCT ON` — while keeping every substring the contract regex greps
  for — fails **7 of the 15** DB assertions. That mutation is invisible to the
  contract test and to every unit test.

## Tests

Full suite: **535 files passed | 7 skipped**, **5648 passed | 42 skipped | 2 todo**.
Net new: 2 overlap regressions + 2 drift assertions + 15 DB assertions;
3 rewritten unit tests went 6 → 11 assertions; 1 guardrail case 2 → 6.

### Gate

```
$ npx vitest run
 Test Files  535 passed | 7 skipped (542)
      Tests  5648 passed | 42 skipped | 2 todo (5692)
   Duration  26.89s

$ npx tsc --noEmit
TypeScript: No errors found
TSC_EXIT=0

$ npx eslint <the 7 changed/added TS files>
ESLint: No issues found
ESLINT_EXIT=0
```

### Scratch-DB run (`scratch_camp_fix`, migrations 001..079, dropped after)

Script: `scratch-camp-fix.sh` (scratchpad), built from the CAMP-012 WI-1 and
CAMP-013 WI-2 scripts: fresh database, stub auth/storage/extensions/realtime,
apply 001..077 in filename order, pre-078 fixtures (S/G/P + a Kushiro-style
hand-tuned row), apply 078 **twice**, apply 079, restore Supabase's baseline
public-schema grants, then the WI-1 assertions in a rolled-back transaction.

M-1 — the file is now idempotent, not just the backfill:

```
== 5a. apply 078 (first time) ==
CREATE FUNCTION
CREATE FUNCTION
psql:…/078_tenant_campaign_settings_seed_on_create.sql:64: NOTICE:  trigger "trg_restaurant_seed_campaign_settings" for relation "restaurants" does not exist, skipping
DROP TRIGGER
CREATE TRIGGER
INSERT 0 3
== 5b. apply 078 a SECOND time (analyzer M-1: DROP TRIGGER IF EXISTS) ==
CREATE FUNCTION
CREATE FUNCTION
DROP TRIGGER
CREATE TRIGGER
INSERT 0 0
== 078 re-applied cleanly: the file is idempotent, not just the backfill ==
== 5c. exactly one trigger of that name survives the re-apply ==
1
== 5d. apply 079 ==
CREATE FUNCTION
CREATE FUNCTION
REVOKE ×3 / GRANT ×1  (per function)
== 001..079 applied ==
```

WI-1 assertions, re-run unchanged on the 078-twice tree:

```
== 6. fixtures + assertions inside a rolled-back transaction ==
BEGIN
NOTICE:  Step 2 passed: S=1000 G=10000 P=100000 K=10000/5 unchanged updated_at=2026-09-09 19:49:15.055091+00, counts equal (restaurants=4, settings=4)
NOTICE:  Step 3 passed: trigger seeds N(pro)=100000, D(default plan)=1000 in the same transaction
NOTICE:  Step 4 passed: re-running the backfill inserted 0 rows, K still 10000
NOTICE:  Step 5 passed (D1): UPDATE restaurants SET plan='pro' left S's settings at 1000 (no sync trigger)
NOTICE:  Step 6 passed: plan_monthly_send_limit(starter/growth/pro/unknown) = 1000/10000/100000/1000
ROLLBACK
== fixtures + assertions applied and rolled back cleanly ==
```

### DB test run (`RUN_DB_TESTS=1`, same scratch DB)

```
$ RUN_DB_TESTS=1 PGDATABASE=scratch_camp_fix npx vitest run \
    src/infrastructure/supabase/__tests__/recipient-rpcs.db.test.ts --reporter=verbose

 ✓ migration 079 — cross-tenant isolation (both restaurant_id predicates) > a poisoned member_tags row claiming tenant A does not leak tenant B's member into an A send
 ✓ … > a poisoned member_tags row claiming tenant B is not honoured on an A call
 ✓ … > resolves exactly the honest active members of the tag, and nothing else
 ✓ … > tenant B resolves no recipients from tenant A's tag
 ✓ migration 079 — a member on two selected tags is ONE recipient (DISTINCT ON) > returns the two-tag member exactly once
 ✓ … > returns each member of the union exactly once
 ✓ migration 079 — unsubscribed members never reach the worker > excludes an unsubscribed member from the tags RPC
 ✓ … > excludes an unsubscribed member from the selection RPC
 ✓ … > the unsubscribed member IS linked to the tag and IS selected (the filter is doing the work)
 ✓ migration 079 — the send set is the set migration 067 counts > row count of active_members_by_tags {tA1} equals count_active_members_by_tags
 ✓ … > … {tA2} …
 ✓ … > … {tA1,tA2} …
 ✓ migration 079 — the selection RPC is scoped by campaigns.restaurant_id > tenant A resolves only its own active selected member
 ✓ … > tenant B resolving tenant A's campaign gets nothing (campaign_members has no tenant column)
 ✓ … > a cross-tenant member sitting in the selection is not returned

 Test Files  1 passed (1)
      Tests  15 passed (15)
   Duration  3.26s
```

Negative control on the same DB (function redefined in place, file untouched,
then 079 re-applied): **7 failed | 8 passed**. Without `RUN_DB_TESTS=1` the
file reports `1 skipped (15 skipped)`.

`scratch_camp_fix` was dropped after the run; `pg_database` back to
`_supabase / postgres / storage_vectors / template0 / template1`.

## Deferred / Tech Debt

- **The DB suite is manual.** There is still no `test:db` rig or CI lane, so
  `recipient-rpcs.db.test.ts` only runs when someone builds a scratch DB and
  sets `RUN_DB_TESTS=1` — same standing gap as the three existing `.db.test.ts`
  files. The negative-control mutation above is the evidence that it bites; a
  CI lane would make that continuous.
- **Offset paging can still skip** a recipient under a concurrent insert.
  Unchanged from before #162 and accepted in the plan. Keyset paging
  (`p_after uuid`) closes it and is the right follow-up if this send path ever
  grows a correctness SLA.
- `resolve-campaign-members-chunks.ts` still carries a name about chunking it
  no longer does (analyzer M-5). Rename deferred by the plan; now also holds
  `dedupeById`, so `-paging.ts` is a slightly better name than it was.

## Review Hand-off

- **The dedupe is client-side and per-call.** It cannot see two *worker
  invocations* of the same campaign; nothing in this change claims to. The
  duplicate class it closes is within one `resolveTargetMembers` walk.
- **`dedupeById` keeps the FIRST row per id.** Every projected column comes
  from `members`, so which duplicate survives is immaterial — but that is an
  assumption about 079's projection, and it would stop holding if a future
  edit projected a column from `member_tags`.
- **The DB test's connection choice is the one deliberate deviation** from an
  in-repo precedent in this round (Key Decision 2). If the project would rather
  standardise on `pg`, that is a one-line change in `psql()` and a
  devDependency — worth a decision rather than a drive-by.
- **Analyzer I-3 remains an ops precondition**, untouched here: capture
  `SELECT plan, status, count(*) FROM restaurants GROUP BY 1,2` and get the
  entitlement sign-off **before** deploying 078. The backfill will not re-run.
- **Not fixed, by brief**: M-2, M-3, M-5, M-6, the create-path ~390-member cap.

## Commits (`2e93cd39` → `4766636c`)

```
1313d902 test(resolve-campaign-members): overlapping pages must yield one recipient (#162 review I-1)
1a07dd3c fix(resolve-campaign-members): dedupe recipients across pages (#162 review I-1)
45728f08 test(plan-quota-contract): tie 078's trigger + backfill to plan_monthly_send_limit (#161 review I-2)
a2347a2d fix(migrations): make 078 re-runnable as the header claims (#161 review M-1)
bf226460 test(recipient-rpc-contract): whitespace-tolerant substring assertions (#162 review M-4)
a2ec98a0 test(recipient-rpcs): assert 079's isolation/dedupe/status against real Postgres (#162 review, Grok Important)
8eeddad0 test(check-campaign-guardrails): pin the plan and assert the fallback warning (#161 review M-1)
4766636c style(resolve-campaign-members-chunks): match the file's em-dash comment style
```

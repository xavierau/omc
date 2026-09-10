---
id: artifacts/2026-09-10-camp-012-013-integration-note
type: artifact
author: senior-backend-dev
created: 2026-09-10
status: active
supersedes: null
superseded_by: null
related: [plans/2026-09-10-camp-012-013-guardrail-defaults-and-recipient-rpc, artifacts/2026-09-10-camp-012-guardrail-defaults-backend, artifacts/2026-09-10-camp-013-recipient-rpc-backend, kanban:CAMP-012, kanban:CAMP-013, github:161, github:162]
---

# WI-3 — Integration verification: #161/#162 on `fix/issues-161-162`

Verifier only, no product-code or test edits made. Branch `fix/issues-161-162`
@ `76055cda` (merges `fix/camp-012` + `fix/camp-013`). `node_modules` was
absent; ran `npm ci` first (837 packages, clean).

## Verdict

**PASS on all four gated criteria (1–4).** Criterion 5 (stop-and-report on
failure) not triggered — nothing failed.

## Criterion 1 — npm ci / vitest / tsc / eslint / next build

```
npm ci: added 837 packages, audited 838 packages in 17s — clean (pre-existing
21 npm-audit advisories, unrelated to this work, unchanged from develop).

npx vitest run:
 Test Files  535 passed | 6 skipped (541)
      Tests  5644 passed | 27 skipped | 2 todo (5673)
   Duration  44.20s
(0 failures; the known-flaky WAQ webhook integration tests — memory
project_flaky_webhook_integration_tests — passed on this run, no isolation
re-run needed)

npx tsc --noEmit:
EXIT:0
(no output — clean)

npx eslint . (this tree):
✖ 171 problems (149 errors, 22 warnings)
EXIT:1

npx eslint . (origin/develop @ 8d65e4f8, temp worktree, npm ci'd separately):
✖ 171 problems (149 errors, 22 warnings)
EXIT:1

diff (paths normalised to strip the worktree prefix so only file:line:rule
content is compared): IDENTICAL — byte-for-byte, same 171 problems on the
same files/lines. Zero new errors, zero new warnings. (eslint's exit 1 in
both cases is the pre-existing baseline — .agents/skills/ tooling scripts
with no-require-imports errors, a react-hooks/set-state-in-effect error in
src/hooks/use-wa-templates.ts, and a scattering of no-unused-vars warnings —
none touched by #161/#162.)

npx next build (off-box; copied .env.local from the primary worktree
~/Code/js/whatsapp-crm for the build only, then deleted it — .env* is
gitignored, git status was clean before and after):
▲ Next.js 16.3.4 (Turbopack)
✓ Compiled successfully in 29.3s
  Finished TypeScript in 30.3s
  Generating static pages using 7 workers (84/84)
EXIT:0
```

**PASS.**

## Criterion 2 — ONE scratch DB, 001..079, WI-1 + WI-2 assertions replayed together

Script: `scratchpad/scratch-camp012-013-wi3.sh` (this session's scratchpad),
adapted from WI-2's `scratch-camp013.sh` (same auth/storage/extensions/
realtime stubs, same post-migration platform-grant restore so the SET ROLE
lockdown assertion proves a function-level denial, not a missing table
grant). DB name `scratch_camp012_013`, Postgres 127.0.0.1:54322.

- Every migration in `supabase/migrations/*.sql` applied via `psql -v
  ON_ERROR_STOP=1`, sorted by filename — 078 then 079, proving numbering
  and apply order on the merged tree.
- Fixtures + all assertions ran inside one `BEGIN … ROLLBACK`, then the DB
  was dropped.

Full output:

```
== 1. drop + create scratch DB ==
DROP DATABASE
CREATE DATABASE
== 2. stub auth/storage/extensions/realtime ==
(schema/function/extension/publication setup, all OK)
== 3. apply every migration 001..079 in filename order ==
== migrations applied cleanly (last: 079_active_members_rpcs.sql) ==
== 3b. restore Supabase's baseline public-schema grants ==
GRANT / GRANT / GRANT
== 4. fixtures + assertions inside a rolled-back transaction ==
BEGIN
 --- WI-1 step: fixtures S/G/P/K ---
INSERT 0 4
NOTICE:  WI-1 trigger step passed: starter=1000, growth=10000, pro=100000
 --- WI-1 step: backfill idempotency ---
 rows_inserted
---------------
             0
NOTICE:  WI-1 backfill-idempotency step passed: 0 rows inserted on re-run, K row byte-identical (lim=10000, daily=5, updated_at unchanged)
NOTICE:  WI-1 D1 no-sync step passed: S still at 1000 after UPDATE restaurants SET plan='pro'
NOTICE:  WI-1 plan_monthly_send_limit direct-call step passed
 --- WI-2 step: fixtures A/B, poison rows, bulk audience ---
INSERT 0 2 / INSERT 0 5 / INSERT 0 4 / INSERT 0 6 / INSERT 0 1500 / INSERT 0 1500 / INSERT 0 2 / INSERT 0 3 / INSERT 0 1500
 --- WI-2 step: parity with count_active_members_by_tags + dedupe ---
 subset_label | rpc_rows | count_rpc | members
--------------+----------+-----------+---------
 {tA1}        |        2 |         2 | A1,A2
 {tA2}        |        1 |         1 | A1
 {tA1,tA2}    |        2 |         2 | A1,A2
NOTICE:  WI-2 parity+dedupe step passed
 --- WI-2 step: cross-tenant poison ---
NOTICE:  WI-2 cross-tenant poison step passed
 --- WI-2 step: unsubscribed member excluded ---
NOTICE:  WI-2 unsubscribed-excluded step passed
 --- WI-2 step: paging a 1,500-member audience (tags) ---
      page       | count
-----------------+-------
 page(1000,0)    |  1000
 page(1000,1000) |   500
 page(1000,1500) |     0
 limit NULL      |  1500
NOTICE:  WI-2 paging step passed: 1000+500 pages, disjoint, union=1500, offset-past-end empty, NULL limit=1500
 --- WI-2 step: selection RPC ---
NOTICE:  WI-2 selection-RPC step passed: cA -> {a1} only, B denied, 1,500-member selection pages disjointly
 --- WI-2 step: 064 lockdown (SET ROLE) ---
NOTICE:  WI-2 lockdown: anon denied on tags -> permission denied for function active_members_by_tags
NOTICE:  WI-2 lockdown: authenticated denied on tags -> permission denied for function active_members_by_tags
NOTICE:  WI-2 lockdown: anon denied on selection -> permission denied for function active_members_by_campaign_selection
NOTICE:  WI-2 lockdown: authenticated denied on selection -> permission denied for function active_members_by_campaign_selection
NOTICE:  WI-2 lockdown step passed: anon+authenticated denied on both (function-level), service_role reads 2 / 1 rows
ROLLBACK
== fixtures + assertions applied and rolled back cleanly ==
== 5. drop scratch DB ==
DROP DATABASE
```

One deviation from a literal re-run of WI-1's original scratch script: WI-1's
original script created restaurants S/G/P/K *before* applying 078 (078 did
not exist yet on that branch). Here 078 is already part of the applied
migration set, so the AFTER-INSERT trigger fires immediately on each
`INSERT INTO restaurants`; K's "pre-existing hand-tuned row" is reproduced by
inserting K, letting the trigger seed its default row, then `UPDATE
tenant_campaign_settings SET monthly_send_limit=10000, daily_campaign_limit=5
WHERE restaurant_id = K` to simulate the admin override — then re-running
078's exact backfill statement and proving it doesn't touch K. Same proof
(idempotent backfill leaves a pre-existing/hand-tuned row byte-identical,
including `updated_at`), reordered to fit a tree where 078 is not the last
migration applied.

**PASS.**

## Criterion 3 — Integration Map walk

| # | Entry | Evidence | Present |
|---|---|---|---|
| I-1 | `supabase/migrations/078_tenant_campaign_settings_seed_on_create.sql` — helper fn, trigger fn, trigger, backfill | File exists (75 lines); contains `plan_monthly_send_limit`, `restaurant_seed_campaign_settings`, `trg_restaurant_seed_campaign_settings`, backfill `INSERT … SELECT … FROM restaurants`; scratch DB step "WI-1 trigger step passed" proves it fires | ✅ |
| I-2 | `supabase/migrations/079_active_members_rpcs.sql` — 2 RPCs + 3 REVOKE / 1 GRANT each | File exists (128 lines), lines 120-128: 3 REVOKE (PUBLIC/anon/authenticated) + 1 GRANT (service_role) for `active_members_by_tags`, same 4 for `active_members_by_campaign_selection` — 8 statements total, exactly 3+1 per function ×2. (`grep -c "REVOKE EXECUTE\|GRANT"` naively returns 9 — it also matches a header-comment line at 29 that mentions "GRANT" in prose; read directly off the file instead of trusting the grep count.) Scratch DB "WI-2 lockdown step passed" proves the lockdown is enforced | ✅ |
| I-3 | `restaurant-repository.ts` `getRestaurantPlan` export | `grep -n getRestaurantPlan` → line 81 `export async function getRestaurantPlan(` | ✅ |
| I-4 | `check-campaign-guardrails.ts` `resolveSettings` → plan-derived fallback + warn | `resolveSettings` (line ~103) calls `planDerivedDefaults(restaurantId)` on a null row; `planDerivedDefaults` (line 112) calls `getRestaurantPlan`, `planCampaignQuota`, `console.warn` | ✅ |
| I-5 | `campaign-guardrails.ts` `checkMonthlyLimit` `>` | Line 73: `if (currentMonthSends + targetMemberCount > monthlyLimit)` — confirmed inclusive (was `>=`) | ✅ |
| I-6 | `resolve-campaign-members.ts` — `fetchTagMembers`, `fetchSelectedMembers` → rpc + `readAllPages`; `MEMBER_COLUMNS` exported; chunk path removed | `export const MEMBER_COLUMNS` (line 9); `fetchSelectedMembers`/`fetchTagMembers` both call `readAllPages(...)` wrapping `supabase.rpc('active_members_by_campaign_selection'/'active_members_by_tags', …)` (lines 75-120) | ✅ |
| I-7 | `resolve-campaign-members-chunks.ts` — `chunk`, `fetchTaggedMemberIds` deleted; doc comment updated | File's only exports are `READ_PAGE_SIZE` and `readAllPages`; header comment explicitly explains `chunk()`/the member-id round trip are gone (#162) | ✅ |
| I-8 | Tests rewritten: `campaign-guardrails.test.ts`, `check-campaign-guardrails.test.ts`, `resolve-campaign-members.test.ts` | All three exist and are part of the green 5644-test run; diffstat vs origin/develop confirms all three changed (32, 71/8, 491 lines respectively) | ✅ |
| I-9 | Tests new: `plan-quota-migration-contract.test.ts`, `recipient-rpc-migration-contract.test.ts`, `getRestaurantPlan` tests | All three files exist (new, per diffstat vs develop) and pass | ✅ |
| I-10 | Regression: `enforce-campaign-guardrails.test.ts`, `change-tenant-plan.test.ts`, `execute-campaign.test.ts`, `tag-audience-repository.test.ts` green | All four files exist, none appear in `git diff origin/develop..HEAD --stat` (byte-identical to develop), and the full vitest run (which includes them) is 100% green | ✅ |
| I-11 | Deploy: `deploy.sh` `supabase db push --linked --include-all` applies 078+079 — no new env vars, no Forge job, no seed change | `git diff origin/develop..HEAD --stat` touches 19 files total, none of them `deploy.sh`, any Forge script, `.env.example`, or a seed file — deploy mechanism unchanged, migrations pick up automatically | ✅ |
| I-12 | Not applicable (routes, nav, i18n, feature flags, DI bindings, permissions, kanban) | Full diffstat vs origin/develop (below) confirms zero route/page/nav/i18n/DI/permission files touched; `.claude/kanban.json`'s only change on this branch is at `7ee475dd` (the plan-authoring commit, before WI-1/WI-2/WI-3), not part of this integration step | ✅ |

Full diffstat, `origin/develop @ 8d65e4f8` → `HEAD @ 76055cda` (19 files,
+1826/-367; the four workspace/kanban files are plan/handoff bookkeeping,
not product surface):

```
.claude-workspace/INDEX.md                                              |   5 +
.claude-workspace/artifacts/2026-09-10-camp-012-guardrail-defaults-backend.md | 165 +++++
.claude-workspace/artifacts/2026-09-10-camp-013-recipient-rpc-backend.md      | 219 +++++
.claude-workspace/plans/2026-09-10-camp-012-013-guardrail-defaults-and-recipient-rpc.md | 445 +++++
.claude/kanban.json                                                      |  51 +
src/application/__tests__/check-campaign-guardrails.test.ts             |  71 +-
src/application/__tests__/resolve-campaign-members.test.ts              | 491 +++---
src/application/check-campaign-guardrails.ts                            |  21 +-
src/application/resolve-campaign-members-chunks.ts                      |  61 +-
src/application/resolve-campaign-members.ts                             |  85 +-
src/domain/services/__tests__/campaign-guardrails.test.ts               |  32 +-
src/domain/services/campaign-guardrails.ts                              |   3 +-
src/domain/value-objects/__tests__/tenant-plan.test.ts                  |   9 +
.../__tests__/plan-quota-migration-contract.test.ts (new)               | 101 +
.../__tests__/recipient-rpc-migration-contract.test.ts (new)            | 155 +
.../__tests__/restaurant-repository.test.ts                             |  54 +
.../supabase/repositories/restaurant-repository.ts                      |  22 +
supabase/migrations/078_tenant_campaign_settings_seed_on_create.sql (new) |  75 +
supabase/migrations/079_active_members_rpcs.sql (new)                    | 128 +
19 files changed, 1826 insertions(+), 367 deletions(-)
```

### Additional absence checks (from the dispatch, beyond the plan's own map)

- `grep -rn "\.in('id'" src/application/resolve-campaign-members*.ts` → **2
  hits, both prose inside comments**, not code:
  - `resolve-campaign-members-chunks.ts:4` — doc comment explaining the old
    `chunk()` helper is gone.
  - `resolve-campaign-members.ts:72` — a `//` comment describing the deleted
    two-step fetch.
  Read literally, the acceptance line ("no `.in('id'` remains") is not
  satisfied as a raw grep — the string is still present twice, in historical
  prose. Functionally it is satisfied: neither occurrence is executable code,
  and both are exactly the kind of "explains why the old shape is gone"
  comment the plan asked WI-2 to add. Flagging rather than silently passing
  it, per the verifier brief.
- `grep -rn "MEMBER_ID_CHUNK_SIZE\|fetchMembersByIds\|fetchTaggedMemberIds" src/`
  → **0 hits.** Clean removal.
- `grep -rn "\bchunk(" src/` → **1 hit**, `resolve-campaign-members-chunks.ts:3`,
  also prose inside the same doc comment (` * resolve-campaign-members.ts. It
  used to also hold a generic \`chunk()\` for`). No `chunk(` function
  definition or call remains anywhere in `src/`.
- `DEFAULT_SETTINGS.monthlySendLimit` no longer the value used when the
  settings row is missing: confirmed by reading `resolveSettings` →
  `planDerivedDefaults` — the returned object is `{ restaurantId,
  ...DEFAULT_SETTINGS, monthlySendLimit }`, where the trailing
  `monthlySendLimit` (the plan-derived value) overrides whatever
  `DEFAULT_SETTINGS.monthlySendLimit` (1000) supplied via the spread. Not a
  test-only claim — read directly off `check-campaign-guardrails.ts:120`.

**PASS**, with the one flagged (non-blocking) literal-grep discrepancy above.

## Criterion 4 — Frozen-suite integrity

```
$ git diff 89c3829c..HEAD --stat -- '*.test.ts'
 src/application/__tests__/check-campaign-guardrails.test.ts |   8 +-
 src/application/__tests__/resolve-campaign-members.test.ts  | 491 +++++++++-----------
 .../__tests__/recipient-rpc-migration-contract.test.ts      | 155 +++++++
 3 files changed, 386 insertions(+), 268 deletions(-)

$ git diff 86144768..HEAD --stat -- '*.test.ts'
 src/application/__tests__/check-campaign-guardrails.test.ts        |  71 ++++++++++++++-
 src/domain/services/__tests__/campaign-guardrails.test.ts          |  32 ++++++-
 src/domain/value-objects/__tests__/tenant-plan.test.ts             |   9 ++
 .../__tests__/plan-quota-migration-contract.test.ts (new)          | 101 +++
 .../__tests__/restaurant-repository.test.ts                        |  54 +++
 5 files changed, 264 insertions(+), 3 deletions(-)
```

These raw diffs are noisy because each freeze point predates the *other*
work item's files (89c3829c is on `fix/camp-012`, before `fix/camp-013`
existed; 86144768 is on `fix/camp-013`, before `fix/camp-012`'s test changes
were merged in). Filtered to each WI's OWN frozen list:

- **WI-1's frozen files** (A1–A10: `campaign-guardrails.test.ts`,
  `tenant-plan.test.ts`, `check-campaign-guardrails.test.ts`,
  `restaurant-repository.test.ts`, `plan-quota-migration-contract.test.ts`,
  `enforce-campaign-guardrails.test.ts`, `change-tenant-plan.test.ts`) —
  since `89c3829c`: only `check-campaign-guardrails.test.ts` changed (8
  lines). The other six are absent from the `89c3829c..HEAD` diff, i.e.
  byte-identical to the frozen commit.
- **WI-2's frozen files** (B1–B10: `resolve-campaign-members.test.ts`,
  `recipient-rpc-migration-contract.test.ts`, `execute-campaign.test.ts`) —
  since `86144768`: **zero changes.** Neither file appears in the
  `86144768..HEAD` diff; `execute-campaign.test.ts` doesn't either.

### WI-1's declared fix (`fdd478f8`), verified

```
$ git log --oneline 89c3829c..HEAD -- src/application/__tests__/check-campaign-guardrails.test.ts
fdd478f8 fix(test): make setupMocks honor an explicit null settings row (#161)
```

Single commit, single file, and the diff is confined entirely to the
`setupMocks` test helper:

```diff
-  mockGetSettings.mockResolvedValue(opts.settings ?? makeSettings())
+  mockGetSettings.mockResolvedValue(
+    opts.settings === undefined ? makeSettings() : opts.settings
+  )
```

Verified by reasoning about JS semantics rather than by editing test files
(edits are out of scope for this verifier): `??` treats `null` and
`undefined` identically, so `opts.settings ?? makeSettings()` returns
`makeSettings()` even when a test explicitly passes `settings: null` to
simulate "no `tenant_campaign_settings` row". Every A3/A4/A6 test that
passes `settings: null` would therefore have exercised the fast (settings
row exists) path in `resolveSettings`, never reaching
`getRestaurantPlan`/`console.warn` — the mocked mismatch WI-1's artifact
describes. The fix changes only the helper's null-vs-undefined handling; no
`it(...)` block or `expect(...)` assertion in the diff. **Confirmed: a
legitimate test-infrastructure bugfix, not a weakened assertion** — it makes
the frozen assertions exercise the code path they were written to test,
rather than loosening what they check.

### WI-2's declared migration-side whitespace fix, verified

`supabase/migrations/079_active_members_rpcs.sql` did not exist at WI-2's
freeze commit `86144768` (it was created together with the implementation
in `10dfa76a`), so there is nothing to diff on the migration side against
the freeze point. The load-bearing check is whether any **test** file moved
between freeze and implementation:

```
$ git diff 86144768..10dfa76a --stat -- '*.test.ts' '**/__tests__/*'
(no output — empty)
```

Confirmed empty: WI-2's claim ("the whitespace change was made to the
migration, not the test") holds — no test file changed at all between the
frozen-red commit and the implementation commit.

**Conclusion: the frozen suite changed exactly once after being written per
WI (each a declared, verified-legitimate test-infrastructure fix), never as
a weakened, skipped, or deleted assertion. PASS.**

## Deferred / Tech Debt

Nothing new. Everything already recorded in the WI-1/WI-2 artifacts stays
deferred as they described:

- `getTodayCampaignCount` / `getMonthlyTenantSends` keyed on
  `campaigns.created_at` (plan Follow-up #1).
- The four `.in('id', ids)` sites audited by WI-2 (`member-tag-bulk.ts:21`,
  `campaign-members-repository.ts:41`, `integration-event-repository.ts:87`,
  and the newly-found `campaign-members-repository.ts:50`
  `getCampaignMemberIds`/`isMemberTargeted` unpaged read) — plan Follow-up
  #2, no fixes shipped here either.
- `resolve-campaign-members-chunks.ts` filename fossil (rename deferred).
- Prod release-notes checks (Kushiro row capture, RPC smoke, worker-log
  check) — WI-3's own step per the plan, belongs to the release runbook,
  not this integration note; not run here (no prod access from this
  dispatch).
- The literal-grep discrepancy on `.in('id'` / `chunk(` above (comments
  only) — cosmetic, no action needed unless a reviewer disagrees.

## Review Hand-off

- **Nothing failed.** No cold-fix dispatch needed for #161/#162 as they
  stand on `fix/issues-161-162` @ `76055cda`.
- **Scope of this note**: verification only. I did not touch
  `check-campaign-guardrails.test.ts`, migration 078/079, or any product
  file — confirmed by `git status --short` being empty for tracked files
  both before and after this session (the only local, gitignored artifact
  was a temporary `.env.local` copy used solely to run `next build`, deleted
  afterward, plus the `.next` build output, also deleted).
- **eslint baseline comparison method**: rather than trust a count match, I
  built a second, detached worktree at `origin/develop @ 8d65e4f8`, ran a
  separate `npm ci` there, ran `eslint .`, and diffed the two normalised
  logs — they are byte-for-byte identical. This is stronger evidence than a
  bare problem-count match (which could hide an error swapped for a
  different error at the same total).
- **Worth a second look** (carried over from WI-1/WI-2, not new): the
  `setupMocks` null-vs-undefined fix and whether the reviewer wants an exact
  warn-string match instead of substring; whether the tags-RPC contract
  test's coupling to migration 067's exact WHERE text is the right
  tradeoff; the newly-found `isMemberTargeted`/`getCampaignMemberIds`
  unpaged-read gap (>1,000 selected members) as a same-class follow-up to
  file alongside #162's other three audit findings.
- **Release runbook** (plan's "Release notes" section) is unexecuted by
  design — this dispatch is pre-merge integration verification, not a
  deploy. The pre/post-deploy Kushiro checks and the RPC smoke test still
  need to happen when this branch actually ships.

## Exact Next Step

Both WI-1 and WI-2 are verified integrated and releasable from a
correctness standpoint (green mechanical gate, green frozen suite, complete
Integration Map, matching perf-budget proof via the scratch-DB paging
steps). Orchestrator's next moves: open the PR from `fix/issues-161-162`
against `develop`, run the review gate (risk-tier: this touches guardrail
enforcement and campaign recipient resolution — a security-relevant
audience-targeting path — so the full dual cross-model gate is the safer
call over a single `/code-review`), then follow the plan's Release notes
section for the deploy runbook (Kushiro pre/post-deploy capture, RPC smoke,
worker-log check).

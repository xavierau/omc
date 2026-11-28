---
id: reviews/2026-09-10-camp-012-013-gstack-review
type: review
author: claude (gstack /review, Pre-Landing PR Review)
created: 2026-09-10
status: active
supersedes: null
superseded_by: null
verdict: ISSUES_FOUND
quality_score: 7.5
related:
  - plans/2026-09-10-camp-012-013-guardrail-defaults-and-recipient-rpc
  - reviews/2026-09-10-camp-012-013-analyzer
  - reviews/2026-09-10-camp-012-013-grok
  - artifacts/2026-09-10-camp-012-013-review-fixes-backend
  - artifacts/2026-09-10-camp-012-013-integration-note
  - github:161
  - github:162
  - github:164
  - kanban:CAMP-012
  - kanban:CAMP-013
---

# gstack /review — PR #164 (CAMP-012 / CAMP-013, #161 + #162)

Branch `fix/issues-161-162` @ `c3a7c769`, base `develop`. Third review pass on this tree,
independent of `…-analyzer` and `…-grok`. Everything those two closed was re-checked against
the code, not re-argued: no already-fixed finding is repeated here.

**Verdict: ISSUES_FOUND — 0 CRITICAL, 5 INFORMATIONAL. PR Quality Score 7.5/10.**
Nothing here blocks the merge. Two of the five (F1, F2) are gaps the plan's Integration Map
says do not exist, and both get *more* reachable because of what this PR ships.

**No product code was edited by this pass.** Every finding is classified AUTO-FIX / ASK for a
separate dispatch, per the orchestrator's brief.

---

## Step 0 / Step 1 — platform and base

- Remote: `github.com` → platform **GitHub**.
- `gh pr view 164 --json baseRefName` → **`develop`**. Used as the base everywhere below.
- `git branch --show-current` → `fix/issues-161-162` (not the base). `git diff origin/develop --stat`
  → 24 files. Review proceeds.
- Reviewed diff (findings scope): `git diff origin/develop -- src supabase` = **15 files,
  1326 insertions, 359 deletions = 1685 lines**. `.claude-workspace/**` and `.claude/**` excluded
  as process artifacts.
- `REPO_MODE=solo`, `TELEMETRY=community`, `LEARNINGS: 3 loaded`, `NO_REVIEWS` in the gstack
  review log for this branch (so Step 5.0 cross-review dedup suppressed nothing).
- Scope signals (`gstack-diff-scope develop`): `BACKEND=true MIGRATIONS=true API=true TESTS=true
  DOCS=true CONFIG=true FRONTEND=true AUTH=false`.

## Step 2.5 — Greptile

`gh api repos/:owner/:repo/pulls/164/comments` → empty. Issue comments: one `coderabbitai[bot]`
notice saying auto-review is **skipped** (base branch is not the default branch). **Zero Greptile
comments — step skipped, as the skill specifies.**

## Codex availability

`codex exec "Reply OK" -s read-only` →
`stream disconnected before completion: You have no credits remaining.`
**Codex unavailable.** Both Codex passes (adversarial + structured review, the latter of which
would have run at 1685 lines) were skipped. Cross-model coverage this round is Claude-only;
the two prior rounds did carry an external model (grok-cli).

---

## Scope Check

```
Scope Check: CLEAN
Intent:    #161 — no tenant silently runs on the hardcoded starter quota; #162 — recipient
           resolution never round-trips member UUIDs through a PostgREST URL filter.
Plan:      .claude-workspace/plans/2026-09-10-camp-012-013-guardrail-defaults-and-recipient-rpc.md
Delivered: migration 078 (plan_monthly_send_limit + AFTER INSERT trigger + idempotent backfill),
           plan-derived guardrail fallback with a named warn, inclusive monthly limit; migration
           079 (two set-returning RPCs, 064 lockdown), both recipient branches paged through
           readAllPages + dedupeById, the chunk path deleted; 8 test files.
Plan items: 34 DONE, 1 PARTIAL, 0 NOT DONE, 2 CHANGED
```

No scope creep. Every changed `src/` and `supabase/` file maps to a plan item or to a finding
closed by the earlier review round. The 22 commits are all in-intent (no "while I was in there").
The `.claude-workspace/` and `.claude/kanban.json` changes are process artifacts, excluded by brief.

Two things the diff does that the plan did not name, both traceable to the analyzer/grok round
and recorded in `artifacts/…-review-fixes-backend`: `dedupeById()` (analyzer I-1) and
`recipient-rpcs.db.test.ts` (grok Important). Not creep — review response.

---

## PLAN COMPLETION AUDIT

Plan: `.claude-workspace/plans/2026-09-10-camp-012-013-guardrail-defaults-and-recipient-rpc.md`

### WI-1 — #161 plan-derived guardrail defaults

| Status | Item | Evidence |
|---|---|---|
| DONE | `plan_monthly_send_limit(text) LANGUAGE sql IMMUTABLE`, CASE 1000/10000/100000/ELSE 1000 | `078:47-56` |
| DONE | `restaurant_seed_campaign_settings()` trigger fn, `ON CONFLICT (restaurant_id) DO NOTHING` | `078:58-66` |
| DONE | `AFTER INSERT ON restaurants FOR EACH ROW` trigger | `078:68-71` (+ `DROP TRIGGER IF EXISTS` at `:68`, added for analyzer M-1) |
| DONE | Idempotent backfill `INSERT … SELECT … ON CONFLICT DO NOTHING` | `078:74-76` |
| DONE | `getRestaurantPlan(id): Promise<TenantPlan \| null>`, throws on error, coerces off-CHECK to `starter` | `restaurant-repository.ts:81-93` |
| DONE | `resolveSettings` → `planDerivedDefaults`, `console.warn` naming tenant + plan + limit | `check-campaign-guardrails.ts:104-121` |
| DONE | `checkMonthlyLimit` `>=` → `>` | `campaign-guardrails.ts:73` |
| DONE | A1 inclusive-boundary cases + `it.each` property grid | `campaign-guardrails.test.ts:17-55` (11-point grid incl. `(1000,0,1000)`, `(0,1000,1000)`, `(1,1000,1000)`) |
| DONE | A2 `DEFAULT_SETTINGS.monthlySendLimit === planCampaignQuota('starter')` | `tenant-plan.test.ts:36-42` |
| DONE | A3–A6 fallback / null-plan / fast-path-untouched / fail-closed | `check-campaign-guardrails.test.ts:273,290,302,313` |
| DONE | A7 `getRestaurantPlan` 4 cases (selects `plan`, null row, throws, coerces) | `restaurant-repository.test.ts:648-698` |
| DONE | A8 PLAN_QUOTAS ↔ SQL CASE parity, no extra keys, ELSE == starter | `plan-quota-migration-contract.test.ts` |
| DONE | A9 trigger/backfill shape + column-subset check | same file; plus the two I-2 drift assertions tying each call site to `plan_monthly_send_limit` |
| DONE | A10 regression suites green | ran clean in my targeted run |

### WI-2 — #162 recipient RPCs

| Status | Item | Evidence |
|---|---|---|
| DONE | `active_members_by_tags(uuid, uuid[], int, int)`, `DISTINCT ON (m.id)`, both tenant predicates, `ORDER BY m.id`, `LIMIT p_limit OFFSET p_offset`, `LANGUAGE sql STABLE` | `079:62-86` |
| DONE | `active_members_by_campaign_selection(uuid, uuid, int, int)` scoped via `c.restaurant_id`, no DISTINCT (PK) | `079:88-118` |
| DONE | 064 lockdown ×2, 3 REVOKE + 1 GRANT on the exact 4-arg signatures | `079:120-128` |
| DONE | `MEMBER_COLUMNS` exported (D8) | `resolve-campaign-members.ts:9-10` |
| DONE | `fetchSelectedMembers` / `fetchTagMembers` → `supabase.rpc` through `readAllPages` | `:75-91`, `:101-119` |
| DONE | `MEMBER_ID_CHUNK_SIZE`, `fetchMembersByIds`, `chunk()`, `fetchTaggedMemberIds` deleted, not retuned | `grep -rn` over `src scripts` → only 2 historical mentions in comments, 0 code refs |
| DONE | `resolve-campaign-members-chunks.ts` header rewritten | `:1-8` |
| DONE | B1–B8 rewritten to the RPC shape, B9 contract test, B10 untouched | 26 `it()` in `resolve-campaign-members.test.ts`; `recipient-rpc-migration-contract.test.ts` 165 lines |
| DONE | Audit of the three surviving `.in('id', …)` sites reported, no fixes shipped | plan WI-2 audit block + PR body "Out of scope" |

### WI-3 — Integration

| Status | Item | Evidence |
|---|---|---|
| DONE | Scratch DB 001..079 in order, WI-1 steps 2–3 + WI-2 steps 2–8 | `artifacts/2026-09-10-camp-012-013-integration-note` |
| CHANGED | "Full `npm run gate`" | **No `gate` script and no `.github/` in this repo** (`package.json` scripts: `dev, build, start, build:release, lint, test, test:watch, test:coverage, seed:demo, resend:welcome, deploy:contact-flow, kanban, kanban:v`). Verified instead by running the 8 changed test files myself: **159 passed, 15 skipped (the gated DB file), 0 failed**. Goal met by different means. |
| PARTIAL | "Walk the Integration Map and tick every row" | I-12 asserts "routes … not applicable (verified)". **False** — `src/app/api/admin/tenants/[id]/campaign-settings/route.ts:35` is a second null-settings fallback site and was not updated (**F2**). |
| CHANGED | Write `artifacts/2026-09-10-camp-012-013-backend.md` | Written as three artifacts (`camp-012-guardrail-defaults-backend`, `camp-013-recipient-rpc-backend`, `camp-012-013-integration-note`) plus the review-fixes note. Same goal, finer grain. |

### Frozen-suite integrity (the acceptance check the orchestrator will want)

Diffed each suite against its freeze commit, not just its result:

| Suite | Freeze | `expect()` at freeze → HEAD | `it()` removed |
|---|---|---|---|
| `campaign-guardrails.test.ts` | `89c3829c` | 22 → 22 | none |
| `check-campaign-guardrails.test.ts` | `89c3829c` | 43 → 46 | 1 (`uses default settings when no tenant settings exist` → renamed `uses plan-derived defaults…`, `:163`, and strengthened per grok Minor) |
| `resolve-campaign-members.test.ts` | `86144768` | 53 → 65 | 3 mock-blind cases, each replaced by a stronger claim (`:462`, `:486`, `:502`) with the SQL-level claims moved into `recipient-rpcs.db.test.ts` |

**No suite was weakened.** Every removal is a rewrite upward, and the removals map 1:1 to grok's
"Important (b)" finding. This satisfies the "frozen suite not renegotiated" criterion.

### DISCREPANCY (the one PARTIAL)

```
DISCREPANCY: PARTIAL | Integration Map I-12 "routes … not applicable (verified)" |
             the admin campaign-settings GET route still falls back to DEFAULT_SETTINGS
INVESTIGATION: Genuinely forgotten. `grep -rn "DEFAULT_SETTINGS" src` returns exactly two
             null-settings fallbacks that read monthlySendLimit; the plan traced one. No commit
             in `origin/develop..HEAD` touches the route, and no artifact mentions it.
IMPACT: LOW — reachable only when a settings row is deleted after 078's backfill, which is the
             precise case the new console.warn exists to catch. But the two views then disagree
             about the tenant's quota, and the admin's "fix" writes the wrong one. See F1/F2.
```

---

## Step 4 — Critical pass (checklist Pass 1) — 0 findings

Each category checked against the diff, with the line that proves the verdict:

- **SQL & Data Safety.** No string-interpolated SQL in application code. The only composed SQL is
  `recipient-rpcs.db.test.ts`, built from module-level UUID constants (`:70-79`), test-only and
  gated. TOCTOU: the 078 seed is an AFTER-INSERT trigger inside the restaurant's own transaction
  with `ON CONFLICT (restaurant_id) DO NOTHING` (`078:57-60`) — atomic by construction, no
  check-then-set. No `update_column`-equivalents. No new N+1: the diff *removes* one (the
  member-id round trip).
- **Race Conditions & Concurrency.** `tenant_campaign_settings.restaurant_id` is UNIQUE (016), and
  every writer targets it: `upsertSettings` (`campaign-settings-repository.ts:33`,
  `onConflict: 'restaurant_id'`), `quality-auto-flags.ts:13,60` (same), the trigger and the
  backfill. **Specifically checked** that 078 does not turn a rarely-taken INSERT path into a
  conflict: it does not, because both upserts name `restaurant_id`, not the PK. Also checked that
  the upsert-as-UPDATE that 078 now makes universal cannot clobber sibling columns —
  `mapSettingsToUpsert` (`campaign-settings-mapper.ts:121-128`) emits only keys that are
  `!== undefined`, so a partial admin edit stays partial. No `dangerouslySetInnerHTML`.
- **LLM Output Trust Boundary.** Not applicable — no LLM call, prompt or LLM-derived value in the diff.
- **Shell Injection.** One subprocess: `execFileSync('psql', [...])` (`recipient-rpcs.db.test.ts:52-57`)
  — argument array, no `shell: true`, no interpolation into argv. Safe.
- **Enum & Value Completeness.** The diff introduces no new enum value. `plan` has four consumers
  and I read all four: `PLAN_QUOTAS` (`tenant-plan.ts:3-7`), `isValidPlan` (`:15-17`), the SQL CASE
  (`078:49-54`), and `chk_plan CHECK (plan IN ('starter','growth','pro'))` (`017:2`). All agree, and
  the TS↔SQL parity is test-enforced (A8), including the `ELSE` arm. `restaurants.plan` is
  `VARCHAR(20)` while the function takes `text` — implicit binary-coercible cast, resolves fine.
  `target_audience` gained no value here (`'all','selected','tag'` since 066).

## Step 4/Pass 2 (informational categories) — checked, nothing to add

Async/sync mixing: N/A (no Python; no sync I/O in an async handler). Column/field-name safety:
every column in 079's `RETURNS TABLE` traced to its migration — `points_balance INTEGER`,
`status TEXT`, `joined_at/last_visit_at TIMESTAMPTZ` (001:14-22), `preferred_language TEXT`
(030:3-4), `pmm_throttled_until/unreachable_at TIMESTAMPTZ` (036:10-12) — all match the declared
types, and the contract test pins the *names* to `MEMBER_COLUMNS`. Version/CHANGELOG: none in repo.
LLM prompt issues: N/A. Time-window safety: `getMonthlyTenantSends` keys on `created_at` — a real
mismatch, but explicitly deferred by the plan and the PR body, so suppressed per "do not flag
anything already addressed". Type coercion: `mapRowToMember` casts are unchanged from `develop`.
View/frontend: no UI file in the diff. Distribution/CI: no CI in this repo.

---

## Step 4.5 / 4.6 — Specialist pass (applied inline, one lens at a time)

Dispatch decision from the scope signals and `gstack-specialist-stats` (6 prior reviews):
**testing** and **maintainability** always-on (1685 lines ≥ 50); **security** (BACKEND && >100
lines, `[NEVER_GATE]`); **performance** (BACKEND); **data-migration** (MIGRATIONS, `[NEVER_GATE]`);
**api-contract** (API). **design skipped** — `SCOPE_FRONTEND=true` comes from the repo's shape, not
from the diff: zero `.tsx`/CSS files changed under `src`. **Red Team activated** (1685 > 200).
Nothing was auto-gated (no specialist is at `[GATE_CANDIDATE]`).

Per the orchestrator's no-nesting rule these ran sequentially in my own context rather than as
subagents, so they do not have the fresh-context independence the skill assumes. Findings are
labelled by lens.

Findings: **7 raw → 5 in the main list, 2 to the appendix** after the confidence gate. No two
findings shared a fingerprint, so no MULTI-SPECIALIST CONFIRMED boost applied.

`quality_score = max(0, 10 − (0 × 2 + 5 × 0.5)) = 7.5`

---

## FINDINGS

Format: `[SEVERITY] (confidence: N/10) file:line — description`

### CRITICAL

None.

### INFORMATIONAL

---

**[INFORMATIONAL] (confidence: 9/10) src/application/resolve-campaign-members.ts:57-69 — the `promo`/`all` and `winback` branches are still unpaged, and #161 raising the monthly quota is what makes the silent 1,000-recipient truncation reachable.**
*Lens: red-team (completeness / cross-cutting). Classification: **ASK**.*

Proof, line by line:
- `fetchActiveMembers` (`:60-68`) and `fetchWinbackMembers` (`:45-54`) issue a bare
  `.select(MEMBER_COLUMNS)` with no `.range()`, no `.order()`, no `readAllPages`.
- `supabase/config.toml:18` → `max_rows = 1000`.
- The module this PR rewrote says it outright: *"An unpaged read is truncated at the project's
  `max-rows` (Supabase default 1000) with NO error — the caller just silently sees fewer rows"*
  (`resolve-campaign-members-chunks.ts:21-23`).
- `campaign-form-types.ts:41` → `targetAudience: 'all'` is the form's default.
- Pre-existing: `git show origin/develop:src/application/resolve-campaign-members.ts` shows the
  same two bodies unchanged.

Why it belongs in *this* review rather than a backlog: this PR does two things that convert a
dormant cap into a live one. It rewrites the two neighbouring branches of the same function to fix
exactly this class, and it raises the enforced monthly quota from a hardcoded 1,000 to
`planCampaignQuota(plan)` — 10,000 for `growth`, 100,000 for `pro`. Before #161 a growth tenant was
capped at 1,000 sends/month anyway, so the 1,000-row read cap was invisible. After #161 it is the
only thing left capping them, and it caps silently.

Failure scenario: growth tenant, 4,000 active members, promo campaign, `targetAudience` left at the
default `'all'`. `resolveTargetMembers` returns 1,000 members. `execute-campaign.ts:47-48` counts
1,000, the guardrail happily allows 1,000 against a 10,000 limit, `sendInBatches` sends 1,000, and
`finalizeCampaignRun` marks the campaign **completed**. 3,000 customers get nothing. No error, no
warning, no counter that disagrees. The merchant's only signal is a delivery report that looks fine.

Recommended fix (~12 lines, two call sites): route both through the helper already imported in this
file — `readAllPages('fetchActiveMembers', (from, to) => supabase.from('members').select(MEMBER_COLUMNS)
.eq('restaurant_id', id).eq('status','active').order('id').range(from, to))`, same for winback with
its `.lt('last_visit_at', cutoff)`. `.order('id')` is required — `readAllPages`' own docstring
(`:33-36`) says the fetcher must impose a total order. Two tests mirroring B4.

Minimum acceptable alternative: if this stays out of scope, add it to the plan's Follow-ups and to
the #162 issue explicitly. It is currently in neither, which is the part I'd push back on — the
plan lists three `.in('id', …)` follow-ups by file and line, and this one is a bigger hole than any
of them.

---

**[INFORMATIONAL] (confidence: 9/10) src/app/api/admin/tenants/[id]/campaign-settings/route.ts:35 — the admin settings view still falls back to the hardcoded 1,000, so it now disagrees with the guardrail it is supposed to describe.**
*Lens: red-team (integration boundary) / absence pass. Classification: **ASK**.*

Proof:
- `route.ts:35` → `const effectiveSettings = settings ?? { restaurantId: id, ...DEFAULT_SETTINGS }`,
  and `DEFAULT_SETTINGS.monthlySendLimit` is `1000` (`campaign-guardrails.ts:48`).
- `check-campaign-guardrails.ts:112-121` now returns `planCampaignQuota(plan)` for the same
  condition.
- `grep -rn "DEFAULT_SETTINGS\|getSettingsForTenant" src` (excluding tests) shows these are the
  only two null-settings fallbacks that resolve a *quota*. The other two callers read something
  else: `execute-campaign.ts:189-190` takes only `perUserMarketingCap` and pacing;
  `stamp-nudge.ts:63-64` only `perUserMarketingCap`. Verified by reading both.
- `route.ts:43` feeds that same value into `buildWarnings(monthlySends, effectiveSettings.monthlySendLimit)`,
  so the admin's "approaching limit" banner is computed against the wrong denominator too.

Failure scenario: a `growth` tenant's settings row is deleted (the residual case after 078's
backfill, and the exact case the new `console.warn` was added to surface). The worker logs
`plan=growth, monthlySendLimit=10000` and enforces 10,000. The platform admin opens the tenant's
campaign-settings tab and reads **1,000**, with a warning banner firing at 800 sends. If they
"correct" it — PUT with `monthlySendLimit: 1000` — `upsertSettings` writes a real row at 1,000 and
the tenant is back to the #161 bug, this time with a row to prove it was intentional.

Recommended fix: export `planDerivedDefaults` from `check-campaign-guardrails.ts` (or lift it to a
shared `resolveEffectiveSettings(restaurantId)`) and call it at `route.ts:35`. ~6 lines plus one
route test. If instead the admin view is *meant* to show the raw row, say so in a comment at `:35`
and drop `DEFAULT_SETTINGS` in favour of returning `settings: null` so the UI can render "not
configured" rather than a fictional number.

Also correct the plan's Integration Map row I-12, which currently claims routes were verified as
not applicable.

---

**[INFORMATIONAL] (confidence: 8/10) src/infrastructure/supabase/__tests__/recipient-rpcs.db.test.ts:40-41 — the only real-SQL proof of migration 079 is opt-in, and nothing in this repo ever opts in.**
*Lens: testing. Classification: **ASK** (touches `package.json`).*

Proof:
- `const RUN = process.env.RUN_DB_TESTS === '1'` / `const d = RUN ? describe : describe.skip` (`:40-41`).
- My run of the eight changed test files: `Test Files 7 passed | 1 skipped (8)`,
  `Tests 159 passed | 15 skipped (174)`. All 15 skips are this file.
- No `.github/` directory exists. `grep -rn RUN_DB_TESTS` finds it only inside the five
  `*.db.test.ts` files themselves — no script, no workflow, no runbook step sets it.

This matters because of what the fix artifact itself demonstrates: an `active_members_by_tags` that
drops `mt.restaurant_id` and `DISTINCT ON`, while keeping every substring
`recipient-rpc-migration-contract.test.ts` greps for, fails **7 of these 15** assertions and **0**
of everything that runs by default. That mutation is a cross-tenant PII leak into a marketing send,
and today the only thing standing between it and `develop` is a human remembering an env var.

It is not a regression — `stamp-rpc.db.test.ts` and `coupon-claim-idempotency.db.test.ts` are gated
the same way, and their own headers admit to being authored-but-unrunnable. That is the point: this
is the third file in that pattern, and the pattern now guards the tenant-isolation predicate.

Recommended fix (smallest useful step): add
`"test:db": "RUN_DB_TESTS=1 vitest run src/**/*.db.test.ts"` to `package.json` and name it as a
pre-release step in the CAMP-012/013 runbook, so it becomes an instruction rather than folklore.
The durable version is a scratch-DB step in CI, which this repo has no CI to host.

---

**[INFORMATIONAL] (confidence: 7/10) src/infrastructure/supabase/__tests__/recipient-rpcs.db.test.ts — the committed DB test proves isolation, dedupe, status and 067 parity, but not the `p_limit`/`p_offset` contract, which is the half of #162 that fixes the >1,000 audience.**
*Lens: testing. Classification: **ASK**.*

Proof: the file's five `describe` blocks cover cross-tenant isolation (4 cases), `DISTINCT ON`
(2), status filtering (3, including a negative control), 067 count parity (3 subsets) and campaign
scoping (3). There is no call anywhere in the file that passes a non-default `p_limit` or
`p_offset` — every helper invocation is `TAGS(rest, tags)` / `SELECTION(rest, campaign)` (`:80-83`),
i.e. `p_limit NULL, p_offset 0`.

The plan *did* specify it — WI-2 scratch step 6: *"`(limit 1, offset 0) ∪ (limit 1, offset 1)` =
full set, disjoint; `(limit NULL)` = full set; `offset ≥ |set|` → 0 rows"* — and the integration
note records it was run by hand. It was not committed. On the TS side, B4/B5
(`resolve-campaign-members.test.ts:307-365`) prove only that `readAllPages` *emits* the offsets,
against a mock that implements slicing in JavaScript.

Failure scenario: a future edit wraps the body in a subquery, or moves `LIMIT/OFFSET` above the
`DISTINCT ON`, changing which rows a given page returns. `toContain('LIMIT p_limit OFFSET p_offset')`
(`recipient-rpc-migration-contract.test.ts:110`) still passes; every unit test still passes; a
2,400-member tag audience silently loses or repeats members at each page boundary. `dedupeById`
masks the repeat and cannot see the drop — so the visible symptom is "some customers didn't get it",
with a completed campaign and a correct-looking recipient count.

Recommended fix: three assertions in the existing gated file, ~12 lines —
`(A,{tA1},1,0) ∪ (A,{tA1},1,1)` equals the full set and is disjoint; `(A,{tA1},NULL,0)` equals the
full set; `(A,{tA1},NULL,5)` returns 0 rows. The fixture already has the two-member audience needed.

---

**[INFORMATIONAL] (confidence: 7/10) supabase/migrations/079_active_members_rpcs.sql:76-85, 106-117 — OFFSET paging re-runs the whole join and sort on every page; the cost curve is fine at the `growth` audience and is not fine at the `pro` one this PR unlocks.**
*Lens: performance. Classification: **ASK / defer with a measurement**.*

Proof:
- Both functions end `ORDER BY m.id LIMIT p_limit OFFSET p_offset` inside a `LANGUAGE sql STABLE`
  body, so each of the N page calls is an independent execution of the full join.
- `member_tags` has `idx_member_tags_tag(tag_id)` and `idx_member_tags_restaurant(restaurant_id)`
  (`065:33-34`) — no composite `(restaurant_id, tag_id)`, and nothing that can supply
  `ORDER BY m.id` for the join output. So each call sorts the entire matched set and then discards
  `p_offset` rows.
- `readAllPages` walks with `pageSize = READ_PAGE_SIZE = 1000` (`resolve-campaign-members-chunks.ts:11`).

At the plan's stated budget (N = 10,000, 11 round trips, ≤5 s) this is 11 full sorts of 10,000 rows
and ~55,000 rows scanned-then-thrown-away by OFFSET. That will hold. At the `pro` quota that #161
now actually enforces — 100,000 — it is 101 calls, 101 sorts of 100,000 rows, and ~5.05M discarded
rows, and the last page costs ~100× the first. Nothing in the diff or the runbook measures the
per-page wall time, so the curve is currently unobserved.

**Explicit non-re-litigation:** the analyzer's I-1 offered keyset paging (`p_after uuid`) as the
durable alternative and the dev declined it with a good reason — it changes 079's signature and
`readAllPages`' contract, which is plan-sized work, not a review fix. I agree and am not reopening
it. This finding records the cost curve so the `pro`-tier case is measured before it is sold, not
discovered by a merchant.

Recommended fix: the release runbook's post-deploy step 4 already calls
`POST /rest/v1/rpc/active_members_by_tags` against Kushiro's 744-member audience. Capture wall time
*per page* there and write it into the deploy artifact, so there is a first data point. Revisit
keyset only if a real audience walk exceeds the 5 s budget.

---

### Appendix — findings below the display threshold (recorded, no action recommended)

**[INFORMATIONAL] (confidence: 4/10) src/application/resolve-campaign-members-chunks.ts:1-8 — module is named `-chunks` and nothing in it chunks.**
*Lens: maintainability.* It exports `READ_PAGE_SIZE`, `readAllPages`, `dedupeById`;
`grep -rn "\bchunk(" src` returns exactly one hit, and it is the comment explaining the history.
The plan deferred the rename as optional churn and invited the reviewer to ask for it (analyzer
M-5 raised it too). **My call: leave it.** A rename touches every importer for zero behavioural
gain, and the header's first sentence now tells the story. If it is ever renamed, `recipient-paging.ts`.

**[INFORMATIONAL] (confidence: 4/10) supabase/migrations/078_tenant_campaign_settings_seed_on_create.sql:47-56 — `plan_monthly_send_limit` carries no REVOKE/GRANT, so `anon` and `authenticated` can call it.**
*Lens: security.* Verified: 078 has no lockdown block, unlike 079's two functions and 067. A
dashboard session can `select plan_monthly_send_limit('pro')` and read the tier ladder. The
function reads no data, and the numbers are commercial config a customer sees on a pricing page, so
the disclosure is nil. D6 in the migration header (`078:16-22`) makes this a stated decision with a
stated reason (revoking EXECUTE would break the trigger for any future non-service-role inserter).
Recording it only so "not locked down" stays a visible choice. No action.

---

## Step 5.5 — TODOS cross-reference

`TODOS.md` exists (2.6 KB) and holds four hackathon-era items: demo seed script, QR deep-link
device testing, extract DESIGN.md, receipt confidence state machine. **This PR closes none of them
and creates no work that belongs there** — the project tracks work in `.claude/kanban.json`
(CAMP-012, CAMP-013, both moved by this branch) and GitHub issues (#161, #162). No cross-reference
to record. Worth noting that `TODOS.md` is itself stale relative to how this project actually
tracks work, but that is outside this diff.

## Step 5.6 — Documentation staleness

- Repo-root `.md` files: `CLAUDE.md` (343 B — kanban pointer + one PRD link) and `TODOS.md`.
  Neither describes campaign guardrails or recipient resolution. **Not stale.**
- `docs/testing-strategy.md` mentions neither `RUN_DB_TESTS`, `*.db.test.ts`, PostgREST, `psql` nor
  scratch databases, so it cannot have gone stale on them — but it also means the new second DB-test
  connection convention (`psql` via `execFileSync`, deliberately diverging from the two supabase-js
  precedents, justified at length in the review-fixes artifact) is documented only inside the test
  file's own header. Low priority; folded into **F3** rather than raised separately.
- `docs/architecture/2026-04-28-waq-p0-vertical-slice-addendum.md` and `docs/tasks/wonb-007-plan.md`
  reference `monthly_send_limit` as historical context for their own slices; neither describes the
  fallback behaviour this PR changes. **Not stale.**

No `/document-release` needed.

## Step 5.7 — Adversarial pass

**Claude adversarial (this reviewer, attacker + chaos-engineer lens).** Ran against the full diff
with no checklist in hand. Everything below was checked; only the two that survived are findings.

Attacked and *held*:
- *Deploy ordering.* `deploy.sh:267,274` runs `supabase db push --linked --include-all` then
  `tsx scripts/seed-platform-admin.ts` then restart. Read the seeder: it touches only
  `platform_admins` (`:72,:85`). So the new AFTER-INSERT trigger cannot collide with the deploy
  seeder. Checked `scripts/seed-demo-data.ts` too — it `.upsert(..., { onConflict: 'id' })`s
  restaurants (`:85-92`), and the trigger only fires on a real INSERT, where `ON CONFLICT DO NOTHING`
  covers a re-run. No breakage on either seed path.
- *Old code + new schema window.* Between `db push` and the restart, `develop`'s code runs against
  078/079. 078 makes rows exist that old code reads correctly (it just enforces the right quota
  early); 079 adds functions old code never calls. Benign in both directions. New code + failed
  migration fails loudly at `fetchTagMembers: …`, and the runbook's step 4 smoke-tests the RPCs
  post-deploy.
- *Upsert conflict-target flip.* 078 turns "row usually absent" into "row always present", which
  converts every `upsertSettings` from an INSERT into an UPDATE. If either upsert had defaulted to
  the PK conflict target, `changeTenantPlan` and the admin PUT would start throwing unique
  violations on day one. Both name `restaurant_id` explicitly
  (`campaign-settings-repository.ts:33`, `quality-auto-flags.ts:13`). And the UPDATE cannot clobber
  siblings, because `mapSettingsToUpsert` emits only defined keys (`campaign-settings-mapper.ts:121-128`).
  This was the failure I most expected to find and it is genuinely closed.
- *`>=` → `>` blast radius.* `checkMonthlyLimit` has exactly one caller
  (`check-campaign-guardrails.ts:144`). No duplicated comparison anywhere in `src`, so the UI and
  the enforcement path cannot disagree. `checkDailyFrequency` keeps `>=` (`:102`) but compares
  already-executed campaigns to the limit, a different shape — both are inclusive in effect. Not a
  finding.
- *Zero/degenerate limits.* `checkMonthlyLimit(0,0,0)` is now `allowed` where it used to block. Only
  reachable with `monthlySendLimit × autoThrottleFactor` flooring to 0, and only with a zero-target
  campaign, which sends nothing. `isApproachingLimit` still special-cases `monthlyLimit === 0`
  (`:127`). Harmless.
- *Fixture cleanup blast radius.* `recipient-rpcs.db.test.ts:85` deletes only its own two fixed
  restaurant UUIDs, never a prefix sweep — which is the shape the `cleanup-deletes-only-what-the-run-created`
  incident asks for. `PGDATABASE` defaults to a non-existent `scratch_camp_fix` so a misfire fails
  loudly. Good.
- *Orphans from the deletion.* `grep -rn "MEMBER_ID_CHUNK_SIZE\|fetchMembersByIds\|fetchTaggedMemberIds"`
  over `src` and `scripts` → two comment mentions, zero code references. No dead imports.

Attacked and *broke* → **F1** (silent truncation on the two branches the PR did not convert, newly
reachable because the PR raised the quota) and **F2** (the second fallback site the Integration Map
says does not exist).

**Codex adversarial:** not run — no credits. **Codex structured review** (which the 1685-line diff
would have triggered): not run, same reason. `GATE: informational`.

### ADVERSARIAL REVIEW SYNTHESIS

```
ADVERSARIAL REVIEW SYNTHESIS (always-on, 1685 lines):
════════════════════════════════════════════════════════════
  High confidence (found by multiple sources):
    (none this round — single-model pass; see the cross-round note below)
  Unique to Claude structured review (Step 4 checklist):
    none — 0 critical, 0 informational
  Unique to Claude adversarial:
    F1 unpaged promo/winback branches (9/10)
    F2 divergent admin-route fallback (9/10)
  Unique to the specialist lenses:
    F3 DB test never runs (testing, 8/10)
    F4 paging contract unproven in SQL (testing, 7/10)
    F5 OFFSET cost curve at the pro tier (performance, 7/10)
  Unique to Codex:
    n/a — Codex unavailable (no credits)
  Models used: Claude structured ✓   Claude adversarial ✓   Codex ✗
════════════════════════════════════════════════════════════

Cross-round agreement worth naming: F1 is the SAME failure class as analyzer I-1 (a page walk
that silently loses recipients) and as the whole of #162 (a read that silently truncates).
Three independent reviewers have now found an instance of "recipient resolution loses people
quietly" in this one function. That is a pattern about the code, not about any one reviewer,
and it argues for closing the last two branches rather than filing them.
```

## Step 5 — Fix-First: REPLACED BY CLASSIFICATION

Per the orchestrator's brief, **no product code was edited**. The Fix-First classification each
finding *would* have received:

| # | Severity | Conf | Site | Would-be class | Why |
|---|---|---|---|---|---|
| F1 | INFORMATIONAL | 9 | `resolve-campaign-members.ts:57-69` | **ASK** | Changes user-visible behaviour (who receives a campaign); ~12 lines + tests; outside the PR's stated scope |
| F2 | INFORMATIONAL | 9 | `admin/tenants/[id]/campaign-settings/route.ts:35` | **ASK** | Two defensible designs (share the fallback vs. show the raw row); a product call, not a mechanical one |
| F3 | INFORMATIONAL | 8 | `recipient-rpcs.db.test.ts:40` + `package.json` | **ASK** | One-line script, but it touches shared config and implies a runbook change |
| F4 | INFORMATIONAL | 7 | `recipient-rpcs.db.test.ts` | **ASK** | Test addition; the skill reclassifies any finding carrying a test to ASK |
| F5 | INFORMATIONAL | 7 | `079:76-85,106-117` | **ASK / defer** | The alternative (keyset) was already considered and declined for cause; the ask is a measurement, not a change |
| A1 | INFORMATIONAL | 4 | `resolve-campaign-members-chunks.ts:1-8` | none | Reviewer's call: leave it |
| A2 | INFORMATIONAL | 4 | `078:47-56` | none | Stated decision (D6), nil impact |

Suggested split for the fix dispatch, if the orchestrator wants one: **F2 + F3 + F4** are a single
tight work item on this branch (a route fallback, a package script, three test assertions — all
small, all provable). **F1** is its own work item and arguably its own PR, because it changes who
gets a message. **F5** is a line in the release runbook.

## Step 5.8 — Review log

Persisted via `gstack-review-log` (see the command output in the session): `skill: review`,
`status: issues_found`, `issues_found: 5`, `critical: 0`, `informational: 5`,
`quality_score: 7.5`, `commit: c3a7c769`, per-specialist stats and per-finding fingerprints
included. A second `adversarial-review` entry records `source: claude`, `gate: informational`
(Codex unavailable).

---

## PR Quality Score: 7.5 / 10

`10 − (0 critical × 2 + 5 informational × 0.5) = 7.5`

What the number does not show: this is a well-built PR. The migration headers explain *why* at the
point of use, the contract tests tie SQL to TS instead of trusting them to agree, the earlier
review round fixed things by making the claim true rather than softening it, and the negative
controls in the fix artifact (mutate the SQL, count which assertions go red) are the right way to
prove a test has teeth. Two of my five findings exist *because* the PR raised a limit that was
previously masking them — which is what shipping a real fix looks like.

The one thing I would not merge without a decision on is **F1**. Everything else can be a
follow-up with a name on it.

## Verdict: ISSUES_FOUND — no blockers

0 CRITICAL. 5 INFORMATIONAL, none of which make the shipped code wrong. F1 and F2 are gaps the
plan's Integration Map claims do not exist, so at minimum the map needs correcting even if the code
does not change. Merge is not gated by this review.

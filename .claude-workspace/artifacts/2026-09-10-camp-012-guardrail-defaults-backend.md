---
id: artifacts/2026-09-10-camp-012-guardrail-defaults-backend
type: artifact
author: senior-backend-dev
created: 2026-09-10
status: active
supersedes: null
superseded_by: null
related: [plans/2026-09-10-camp-012-013-guardrail-defaults-and-recipient-rpc, kanban:CAMP-012, github:161]
---

# WI-1: #161 plan-derived guardrail defaults (CAMP-012)

Branch `fix/camp-012` (worktree `whatsapp-crm-camp-012`, forked from
`fix/issues-161-162`). WI-2 (#162, recipient RPCs, migration 079) is a
sibling worktree and is untouched here.

## Files Changed

| File | Lines | Purpose |
|---|---|---|
| `supabase/migrations/078_tenant_campaign_settings_seed_on_create.sql` | +75 (new) | `plan_monthly_send_limit(text)` helper, AFTER INSERT trigger on `restaurants`, idempotent backfill |
| `src/domain/services/campaign-guardrails.ts` | +2/-1 | `checkMonthlyLimit`: `>=` → `>` (D2, inclusive boundary) |
| `src/infrastructure/supabase/repositories/restaurant-repository.ts` | +22 | new `getRestaurantPlan(restaurantId)` |
| `src/application/check-campaign-guardrails.ts` | +20/-1 | `resolveSettings` → `planDerivedDefaults` helper: plan-derived limit + single `console.warn` |
| `src/domain/services/__tests__/campaign-guardrails.test.ts` | rewritten `checkMonthlyLimit` block | A1 |
| `src/domain/value-objects/__tests__/tenant-plan.test.ts` | +8 | A2 |
| `src/application/__tests__/check-campaign-guardrails.test.ts` | +58/-1 (incl. a `setupMocks` bugfix) | A3–A6 |
| `src/infrastructure/supabase/repositories/__tests__/restaurant-repository.test.ts` | +47 | A7 |
| `src/infrastructure/supabase/repositories/__tests__/plan-quota-migration-contract.test.ts` | +99 (new) | A8, A9 |

Commits (`fix/camp-012`, oldest first): `89c3829c` (frozen suite, red) →
`fdd478f8` (setupMocks fix) → `2022e545` (migration 078) → `1beec521`
(inclusive boundary) → `cf30270f` (`getRestaurantPlan`) → `ee884f52`
(plan-derived fallback). No push, no PR, no merge.

## Key Decisions

- **D1–D8 from the plan implemented as written** — no deviations from the
  design decisions section. `plan_monthly_send_limit` is not locked down
  (D6); no UPDATE-of-plan sync trigger (D1); fail-closed on a throwing
  plan read (D3).
- **Deviation (necessary, not a weakening): fixed a latent bug in
  `check-campaign-guardrails.test.ts`'s `setupMocks` helper.**
  `mockGetSettings.mockResolvedValue(opts.settings ?? makeSettings())`
  collapsed an explicitly-passed `settings: null` back to a full default
  row, because `??` treats `null` and `undefined` identically. This
  silently defeated the frozen A3/A4/A6 tests (`checkCampaignGuardrails`
  never actually saw a missing-row case) — confirmed by running the suite
  red before the fix (see Tests below) and seeing A3/A4/A6 fail for the
  wrong reason (`getSettingsForTenant` never resolved `null`). Changed to
  `opts.settings === undefined ? makeSettings() : opts.settings`. The
  pre-existing "uses default settings when no tenant settings exist" test
  now genuinely exercises the null-row path and still passes unchanged.
  Committed separately (`fdd478f8`) from the frozen-suite commit so the
  distinction is visible in history.
- **Warn message format**: exactly as specified in the plan —
  `` `[Guardrails] tenant_campaign_settings missing for tenant ${id}; using plan-derived defaults (plan=${plan}, monthlySendLimit=${limit}) — migration 078 should have seeded this row` ``.
  Tests assert substring containment (`plan=growth`, `monthlySendLimit=10000`,
  the tenant id), not the exact string, so minor wording drift won't break
  the suite while still pinning the load-bearing content.
- **A9 column-subset check needed no fallback comment.** The plan flagged
  a risk that `columnsForTable` might not fold `ALTER TABLE ... ADD
  COLUMN`, in which case A9 would need to assert against the 016 base
  columns only. Verified: `parse-schema.ts`'s `columnsFromAlterTable` DOES
  fold `ADD COLUMN` (confirmed against 040/042/043/049, all of which use
  `ADD COLUMN` per clause in a single `ALTER TABLE`), so the full
  20-column set is available and no fallback/comment was needed.

## Tests

- Before this WI: 533 test files / 5,594 tests passing (full `npx vitest run`).
- After: **534 test files / 5,625 tests passing**, 0 failing, 27 skipped / 2 todo (unchanged, pre-existing).
- Frozen suite (A1–A10), run in isolation: 7 files / 124 tests, all green:
  `campaign-guardrails.test.ts`, `tenant-plan.test.ts`,
  `check-campaign-guardrails.test.ts`, `restaurant-repository.test.ts`,
  `plan-quota-migration-contract.test.ts`,
  `enforce-campaign-guardrails.test.ts` (A10, unchanged),
  `change-tenant-plan.test.ts` (A10, unchanged).
- Suite was shown red before implementation (commit `89c3829c`): 13 tests
  failing across 4 files for the expected reasons (`>=` boundary,
  `getRestaurantPlan is not a function`, missing migration 078). No test
  was weakened, skipped, or deleted after being frozen — the one change to
  a test file post-freeze (`fdd478f8`) is a bugfix to test *infrastructure*
  that made three of the frozen assertions (A3/A4/A6) exercise the real
  code path instead of silently no-op'ing; the assertions themselves are
  unchanged from the frozen commit.
- `npx tsc --noEmit`: clean.
- `npx eslint` on every changed file: 0 errors. 1 pre-existing warning
  (`TenantPlan` unused import in `tenant-plan.test.ts`) confirmed present
  before my changes via `git stash` + lint (not introduced by this work).
- Gaps: no `npm run gate` script exists in this repo (checked
  `package.json`) — ran `vitest run` + `tsc --noEmit` + `eslint` directly
  per the dispatch brief instead.

## Scratch-DB Validation

Script: `scratch-db-camp012.sh` (scratchpad), adapted from the WI-7
technique. `scratch_camp012` on local Postgres (127.0.0.1:54322), migrations
001–077 applied, then 078, then fixtures/assertions inside
`BEGIN … ROLLBACK`, then `DROP DATABASE`. Output (all 6 steps passed):

```
== 5. apply 078 ==
CREATE FUNCTION
CREATE FUNCTION
CREATE TRIGGER
INSERT 0 3          -- backfill: exactly S, G, P (K already had a hand-made row)
== 078 applied cleanly ==
== 6. fixtures + assertions inside a rolled-back transaction ==
BEGIN
NOTICE:  Step 2 passed: S=1000 G=10000 P=100000 K=10000/5 unchanged updated_at=2026-09-09 18:58:36.524904+00, counts equal (restaurants=4, settings=4)
NOTICE:  Step 3 passed: trigger seeds N(pro)=100000, D(default plan)=1000 in the same transaction
NOTICE:  Step 4 passed: re-running the backfill inserted 0 rows, K still 10000
NOTICE:  Step 5 passed (D1): UPDATE restaurants SET plan='pro' left S's settings at 1000 (no sync trigger)
NOTICE:  Step 6 passed: plan_monthly_send_limit(starter/growth/pro/unknown) = 1000/10000/100000/1000
ROLLBACK
== fixtures + assertions applied and rolled back cleanly ==
```

One technique note for whoever runs the next scratch-DB script off this
precedent: psql does **not** interpolate a shell `-v var=value` reference
(`:'var'`) inside a `DO $$ ... $$` block reliably across separate psql
invocations in this setup — it errored `syntax error at or near ":"`.
Fixed by stashing the pre-migration value in a plain (non-temp) table
(`_scratch_stash`) created in an earlier invocation and reading it back
inside the later transaction, instead of shell-to-psql variable passing.

## Deferred / Tech Debt

Everything below is explicitly out of scope for WI-1 per the plan — not
missed, just recorded:

- `getTodayCampaignCount` / `getMonthlyTenantSends` keying on
  `campaigns.created_at` instead of send time (plan's Follow-up #1,
  out of scope, untouched).
- WI-2 (#162 recipient RPCs, migration 079) — separate worktree.
- No UPDATE-of-plan sync trigger (D1, deliberate).
- Kanban update — orchestrator's job, not touched.

## Review Hand-off

- **Scope check for reviewer**: diff should touch exactly the 4 non-test
  files + migration 078 + the 5 test files listed above. Nothing in
  `resolve-campaign-members*.ts`, migration 079, or `.claude/kanban.json`.
- **Worth a second look**: the `setupMocks` bugfix (`fdd478f8`) — verify it
  really is a pre-existing latent bug (I confirmed by reverting it and
  re-running: A3/A4/A6 fail because `getSettingsForTenant` never resolves
  `null`) and not an accidental behavior change to the fast path (A5
  proves the fast path — a real settings row — still skips
  `getRestaurantPlan` and `console.warn` entirely).
- **Warn message**: only substring-tested; if the reviewer wants an exact
  string match test instead, that's a one-line change, flagging as a
  judgment call rather than doing it unasked.
- **Release note reminder** (from the plan, WI-3's job, not mine): 078 is
  data-changing (backfill) — the plan's pre/post-deploy prod checks
  against Kushiro's row still apply verbatim; nothing in this WI changes
  those.

## Exact Next Step

WI-1 is complete and green. Next: either WI-2 (#162, sibling worktree,
independent) or WI-3 (integration — rebuild one scratch DB with 078+079
together, full gate, Integration Map walk, final artifact) once WI-2 lands.
No action needed on this worktree beyond review.

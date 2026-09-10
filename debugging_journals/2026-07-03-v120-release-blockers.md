# v1.2.0 release blockers — build break, silent consent bug, stamp RLS gap (REL-001)

## Problem

The develop → main promotion ("merge once the review is clean") was BLOCKED
by the release-readiness review: `next build` failed on develop, migration
050's stamp tables had no RLS, and (found while fixing) the import wizard
page hard-failed prerendering.

## Root causes

1. **`consent-record-repository.ts` — `.select('id', { count: 'exact' })`
   after `.update()`.** A post-mutation `.select()` takes no options in
   supabase-js, so this was simultaneously (a) the one type error in
   production code, failing `next build`, and (b) a runtime no-op: the
   count preference was never sent, `count` was always null, and
   `upgradeToOptedIn` always returned `false` — YES replies flipped the
   consent row but the flow took the unknown-command path and never emitted
   `consent_granted`. It never reached production only because the broken
   build blocked every deploy.
2. **The error hid in "baseline noise".** 17 additional type errors —
   fixture/mock drift across 8 test files — had normalized `tsc --noEmit`
   failures ("pre-existing 18 errors"). vitest doesn't typecheck, so the
   suite stayed green for weeks. There is no CI to force the issue.
3. **Migration 050 created `stamp_campaigns` and `member_stamp_cards`
   without RLS** — cross-tenant readable and writable via PostgREST with
   the anon key. Every sibling tenant table in the release had the standard
   policy; this was an omission.
4. **`/dashboard/members/import` used `useSearchParams()` without a
   Suspense boundary** — Next 16 fails the entire production build at
   prerender (missing-suspense-with-csr-bailout).

## Solution (PR #48, released in #49 / v1.2.0)

- Count preference moved onto the `.update()` itself; test harness mocks
  the honest chain (thenable filter builder; count returned only when the
  option is actually sent, so every test enforces the wiring).
- All 18 type errors zeroed, preserving each test's intent — `tsc --noEmit`
  is now 0 and must stay 0.
- Migration 052 adds RLS + tenant SELECT policies (038/044 pattern) with a
  `RUN_DB_TESTS`-gated enforcement suite.
- Import wizard wrapped in `<Suspense>` (only `useSearchParams` call site).
- WAQ/opt-in env vars documented in `.env.example` + `deploy/README.md`.

## Prevention

- **Never accept a non-zero typecheck as "baseline".** The one deploy
  blocker was indistinguishable from test-fixture noise until the noise
  was zeroed.
- **CI-001 filed (high priority)**: a per-PR gate of `tsc --noEmit` +
  `vitest run` + `next build`. The Suspense/prerender failure class is
  only catchable by an actual production build.
- **RLS check belongs in migration review**: any `CREATE TABLE` with
  `restaurant_id` needs `ENABLE ROW LEVEL SECURITY` + policy in the same
  migration, plus a gated enforcement test.
- Release promotions get a devops release-readiness review (migrations,
  env, runtime shape, rollback) — it caught all of this.

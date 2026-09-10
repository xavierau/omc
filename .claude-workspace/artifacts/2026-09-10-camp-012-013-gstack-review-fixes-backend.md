---
id: artifacts/2026-09-10-camp-012-013-gstack-review-fixes-backend
type: artifact
author: senior-backend-dev
created: 2026-09-10
status: active
supersedes: null
superseded_by: null
related:
  - reviews/2026-09-10-camp-012-013-gstack-review
  - plans/2026-09-10-camp-012-013-guardrail-defaults-and-recipient-rpc
  - artifacts/2026-09-10-camp-012-013-review-fixes-backend
  - github:161
  - github:162
  - github:164
  - kanban:CAMP-012
  - kanban:CAMP-013
---

# gstack review fixes: CAMP-012 / CAMP-013 (#161 / #162), PR #164

Cold fix round on `fix/issues-161-162`, starting from `fb12b80e` (the tree the
gstack review read as `c3a7c769` plus its own review artifact). Four actionable
findings from `reviews/2026-09-10-camp-012-013-gstack-review`. Final **code**
SHA **`f39e2a98`**.

## Per-finding disposition

| Finding | Verdict | What was done |
|---|---|---|
| **F1** — promo/`all` and winback branches unpaged | **Valid, fixed** | Both route through `readAllPages` with `.order('id')` + `.range(from, to)`. Red test `806a77a1`, fix `3bb41aab`. |
| **F2** — admin route falls back to the hardcoded 1,000 | **Valid, fixed** | `planDerivedDefaults` exported from `check-campaign-guardrails.ts` and called at the route's null-settings branch; no logic duplicated. Red test `7f07de85`, fix `22918d7d`, plan I-12 corrected `83f18cb0`. |
| **F3** — nothing runs the DB test | **Valid, fixed with a caveat** (see below) | `"test:db"` npm script + a rewritten HOW TO RUN header. `f39e2a98`. |
| **F4** — paging never asserted against real SQL | **Valid, fixed** | 1,500-row fixture + partition assertions for both RPCs, run for real, mutation-proven. `f39e2a98`. |
| 7/10 OFFSET cost curve, 4/10 appendix items | **Out of scope by brief** | No code change. F5 remains a runbook item; A1/A2 remain the reviewer's stated "leave it". |

No finding was judged wrong. Nothing was weakened or deleted to make a build
green — the only pre-existing test helper rewritten (`setupChain`) went from a
mock that could not page at all to one that windows like PostgREST, and the
five tests using it keep their claims unchanged.

## Files Changed

| File | Lines | Purpose |
|---|---|---|
| `src/application/resolve-campaign-members.ts` | +33 / -18 | F1: `activeMembersOf` builder; both branches page through `readAllPages` + `dedupeById` |
| `src/application/__tests__/resolve-campaign-members.test.ts` | +112 / -12 | F1: `setupChain` windows + records per page; 2 new cases (1,500-row promo, 1,500-row winback with per-page cutoff) |
| `src/application/check-campaign-guardrails.ts` | +5 / -1 | F2: `planDerivedDefaults` exported, with the reason at the export |
| `src/app/api/admin/tenants/[id]/campaign-settings/route.ts` | +4 / -2 | F2: null-settings branch calls `planDerivedDefaults`; `DEFAULT_SETTINGS` import dropped (orphan) |
| `src/app/api/admin/tenants/[id]/campaign-settings/__tests__/route.test.ts` | +114 (new) | F2: growth tenant → 10,000; warning denominator; stored-row control |
| `src/infrastructure/supabase/__tests__/recipient-rpcs.db.test.ts` | +125 / -8 | F3 header; F4 bulk fixture + 4 partition assertions |
| `package.json` | +1 | F3: `test:db` |
| `.claude-workspace/plans/…-guardrail-defaults-and-recipient-rpc.md` | ±1 | F2: Integration Map row I-12 corrected |

## Key Decisions

**1. F1 also gets `dedupeById`, which the finding did not ask for.** The
recommended fix was `readAllPages` + `.order('id')` + `.range()`. A `.range()`
walk has the identical cross-page duplicate hazard the analyzer's I-1 closed
for the two RPC branches: an OFFSET/range window indexes positions, not rows,
so a member INSERTed mid-walk shifts every later row down one position and the
row on the page boundary is returned twice. Leaving two of the four branches of
the same function deduped and two not would have been an invisible asymmetry.
One extra call per branch, and the module's docstring already explains it.

**2. `activeMembersOf` stays in `resolve-campaign-members.ts`.** The brief
allowed moving a builder helper into `resolve-campaign-members-chunks.ts` if
the file blew its budget. It did not need to: the shared builder removes the
duplicated filter chain, and the file lands at exactly **150 lines**. Moving it
would have coupled the paging module — which currently imports nothing — to the
Supabase client type for no gain.

**3. F2 shares the resolver rather than the shape.** The finding offered a
second design (return `settings: null` and let the UI render "not configured").
Not taken: it is a UI contract change on a route the brief did not scope, and
the sharing option closes the divergence with 4 lines. Note the shared call
also brings the `console.warn` to the admin path, which is correct — a settings
row missing after 078's backfill is exactly the event that warning exists to
surface, and an admin opening the tab is a fine place to surface it.

**4. F3 is implemented exactly as briefed, and the script is knowingly
imperfect.** `"test:db": "RUN_DB_TESTS=1 vitest run src/infrastructure/supabase/__tests__"`
runs all five gated files in that directory. Only `recipient-rpcs.db.test.ts`
connects to a scratch database via `psql`; the other four
(`stamp-rpc`, `stamp-rls`, `platform-settings`, `coupon-claim-idempotency`)
call `createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)` and
each says in its own header that the PostgREST rig it needs was never built.
With the gate open they **fail rather than skip**, so `npm run test:db` is red
by construction today. **This is flagged, not silently worked around:** the
brief specified the script value verbatim, so it ships verbatim, and the test
file's header now states plainly which file is runnable and gives the
single-file command. If the orchestrator wants the script green on a scratch
DB, the one-word change is to point it at `…/recipient-rpcs.db.test.ts`; if it
wants all five, the missing work is the PostgREST rig, which is plan-sized.

**5. F4 claims a partition, not a row count.** The obvious assertion —
`page(1000,0)` is 1000 rows and `page(1000,1000)` is 500 — is exactly the one
the failure mode survives: a body that re-sorts before windowing returns the
right *counts* on both pages while the pages overlap and drop members. The
committed claim is therefore set-level: disjoint, and union equal to the
`p_limit NULL` result. The negative control below shows the count assertion
staying green while the partition assertion goes red.

## Tests

Net new: 2 unit cases (F1), 3 route cases (F2), 4 DB cases (F4). Full suite
**536 files passed | 7 skipped**, **5653 passed | 46 skipped | 2 todo** — up
from 5648 passed / 42 skipped before this round (the 4 extra skips are the new
gated DB cases).

### Gate (final tree, `f39e2a98`)

```
$ npx vitest run
 Test Files  536 passed | 7 skipped (543)
      Tests  5653 passed | 46 skipped | 2 todo (5701)
   Duration  28.42s

$ npx tsc --noEmit
TSC_EXIT=0        (no output)

$ npx eslint <the 6 changed/added TS files>
ESLINT_EXIT=0     (no output)
```

### DB-test run (`scratch_camp_fix2`, migrations 001..079, dropped after)

Scratch script `scratch-camp-fix2.sh` (scratchpad), same technique as the
CAMP-013 WI-2 script: fresh database, stub auth/storage/extensions/realtime,
`psql -f` all 79 migrations in filename order, restore Supabase's baseline
public-schema grants.

```
$ PGDATABASE=scratch_camp_fix2 RUN_DB_TESTS=1 npx vitest run \
    src/infrastructure/supabase/__tests__/recipient-rpcs.db.test.ts --reporter=verbose

 ✓ migration 079 — cross-tenant isolation (both restaurant_id predicates) > a poisoned member_tags row claiming tenant A does not leak tenant B's member into an A send 59ms
 ✓ … > a poisoned member_tags row claiming tenant B is not honoured on an A call 57ms
 ✓ … > resolves exactly the honest active members of the tag, and nothing else 59ms
 ✓ … > tenant B resolves no recipients from tenant A's tag 58ms
 ✓ migration 079 — a member on two selected tags is ONE recipient (DISTINCT ON) > returns the two-tag member exactly once 53ms
 ✓ … > returns each member of the union exactly once 59ms
 ✓ migration 079 — unsubscribed members never reach the worker > excludes an unsubscribed member from the tags RPC 58ms
 ✓ … > excludes an unsubscribed member from the selection RPC 60ms
 ✓ … > the unsubscribed member IS linked to the tag and IS selected (the filter is doing the work) 116ms
 ✓ migration 079 — the send set is the set migration 067 counts > row count of active_members_by_tags {tA1} equals count_active_members_by_tags 111ms
 ✓ … > … {tA2} … 112ms
 ✓ … > … {tA1,tA2} … 109ms
 ✓ migration 079 — the selection RPC is scoped by campaigns.restaurant_id > tenant A resolves only its own active selected member 53ms
 ✓ … > tenant B resolving tenant A's campaign gets nothing (campaign_members has no tenant column) 60ms
 ✓ … > a cross-tenant member sitting in the selection is not returned 117ms
 ✓ migration 079 — the p_limit/p_offset window partitions the full set > active_members_by_tags pages a 1,500-row audience as 1000 + 500, then empty 234ms
 ✓ … > active_members_by_campaign_selection pages a 1,500-row audience as 1000 + 500, then empty 242ms
 ✓ … > active_members_by_tags pages are disjoint and their union IS the p_limit NULL result 252ms
 ✓ … > active_members_by_campaign_selection pages are disjoint and their union IS the p_limit NULL result 257ms

 Test Files  1 passed (1)
      Tests  19 passed (19)
   Duration  2.68s
```

### Negative control for F4 (mutation, run and reverted)

079's tags body wrapped as `SELECT * FROM ( …existing body incl. ORDER BY m.id… ) s ORDER BY random() LIMIT p_limit OFFSET p_offset`
— every substring `recipient-rpc-migration-contract.test.ts` greps survives
(`DISTINCT ON (m.id)`, both `restaurant_id` predicates, `ORDER BY m.id`,
`LIMIT p_limit OFFSET p_offset`):

```
--- contract test against the MUTATED file ---
 Test Files  1 passed (1)
      Tests  14 passed (14)

--- DB test against the MUTATED function ---
     × active_members_by_tags pages are disjoint and their union IS the p_limit NULL result 66ms
 Tests  1 failed | 18 passed (19)
```

The count-level case ("1000 + 500, then empty") stayed **green** under the
mutation. Only the partition assertion caught it. 079 was restored with
`git checkout` and re-applied; the suite returned to 19/19 before the scratch
DB was dropped.

### F1 red-then-green

The RED commit `806a77a1` failed **7 of 28** — the 2 new cases plus the 5
pre-existing `setupChain` cases, which is the honest signal that the old code
issued a chain with no `.range()` at all. `3bb41aab` took it to 28/28.

### F2 red-then-green

The RED commit `7f07de85` failed **2 of 3**: the growth-tenant quota
(`1000` vs `10000`) and the warning denominator (`Approaching monthly send
limit (900/1000)` where the worker would enforce 10,000). The third case —
a stored row is returned untouched and the plan is never read — passed before
the fix, so the two failures isolate the divergence rather than the route.

## Deferred / Tech Debt

- **F5 (7/10, OFFSET cost curve at the `pro` tier)** — untouched by brief. Still
  a release-runbook item: capture per-page wall time on the post-deploy
  `active_members_by_tags` smoke call and write it into the deploy artifact.
- **A1 / A2 (4/10)** — `resolve-campaign-members-chunks.ts` naming and 078's
  missing REVOKE/GRANT. Both are the reviewer's own "leave it"; unchanged.
- **`npm run test:db` is red by construction** — see Key Decision 4. Either
  narrow the glob or build the PostgREST rig the other four files need.
- **The promo/winback OFFSET curve is now the same shape as F5's.** F1 converts
  two unpaged reads into range walks over `members`, which has
  `idx_members_restaurant` — a 100,000-member `pro` promo audience is 101 page
  reads. Same cost class as F5, same measurement would cover both.

## Review Hand-off

- **F1 changes who receives a campaign.** A promo/`all` or winback audience
  above 1,000 now resolves completely where it previously resolved to 1,000.
  For a tenant already over the cap this is a behaviour change in production on
  the first send after deploy: more recipients, more spend, and the guardrail
  (correctly) starts blocking runs it used to allow. This is the fix, but it
  should be named in the release runbook rather than discovered.
- **F2 brings a `console.warn` onto an admin GET.** One line per request for a
  tenant whose settings row is missing. Intended; flagging it so it is not read
  as log noise.
- `setupChain`'s signature is unchanged (`{ data, error }`), but the mock no
  longer honours `error` — no test used it, and the two branches' error paths
  are now readAllPages', which is covered for the RPC branches. If a reviewer
  wants the promo/winback error label pinned, that is one test, not a redesign.
- The F4 fixture adds 1,500 members / 1,500 member_tags / 1,500 campaign_members
  to the seed. Cleanup is unchanged: `DELETE FROM restaurants WHERE id IN (A, B)`
  by exact id, never a prefix sweep.

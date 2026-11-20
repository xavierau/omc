---
id: reviews/2026-09-10-camp-012-013-delta-analyzer
type: review
author: code-review-analyzer
created: 2026-09-10
status: active
supersedes: null
superseded_by: null
verdict: APPROVED
related:
  - reviews/2026-09-10-camp-012-013-gstack-review
  - reviews/2026-09-10-camp-012-013-analyzer
  - reviews/2026-09-10-camp-012-013-grok
  - artifacts/2026-09-10-camp-012-013-gstack-review-fixes-backend
  - artifacts/2026-09-10-camp-012-013-review-fixes-backend
  - plans/2026-09-10-camp-012-013-guardrail-defaults-and-recipient-rpc
  - github:161
  - github:162
  - github:164
  - kanban:CAMP-012
  - kanban:CAMP-013
---

# Delta re-review: PR #164 fixes (`c3a7c769..d8249514`)

Scope: **only** the delta `git diff c3a7c769..d8249514 -- src supabase package.json` — the fix
round that closes F1–F4 of `reviews/2026-09-10-camp-012-013-gstack-review`. Nothing the three
earlier passes closed is re-argued; nothing outside the delta is re-reviewed. Gate-covered
dimensions (types, lint, complexity, size budgets, dead code) are excluded by brief.

## Summary

Four findings, four fixes, all correct. Every changed line traces to F1–F4; `supabase/` is
untouched by the delta (the SQL was already right — F4 only added proof of it). Red-then-green
discipline is real: `806a77a1` and `7f07de85` are test-only commits, and the fixes land after them
in `3bb41aab` / `22918d7d`. No test was deleted or weakened — the case count on the one rewritten
test file goes 26 → 28 `it()`, the DB file 15 → 19, and the `-13` lines in the DB diff are the
replaced HOW-TO-RUN header, not assertions.

**0 CRITICAL, 0 IMPORTANT, 3 MINOR.** Verdict **APPROVED**. The three minors are a stale comment,
an under-documented (not un-mitigated) concurrency direction, and a portability note — none is a
code defect and none warrants a fix round of its own.

Verification run locally on `d8249514` (read-only, no product code touched):

```
npx vitest run resolve-campaign-members.test.ts campaign-settings/route.test.ts \
               check-campaign-guardrails.test.ts execute-campaign.test.ts
  Test Files  4 passed (4)   Tests  103 passed (103)

npx vitest run recipient-rpcs.db.test.ts      # default env, gate closed
  Test Files  1 skipped (1)  Tests  19 skipped (19)
```

---

## 🔴 Critical (Must Fix)

None.

## 🟡 Important (Should Fix)

None.

## 🟢 Minor (Optional)

### M1 — `src/application/resolve-campaign-members-chunks.ts:66` — `dedupeById`'s docstring is stale after the delta

`"this is that guarantee, restored for both branches (review I-1, #162)"` was written when
`dedupeById` had two call sites (`fetchSelectedMembers`, `fetchTagMembers`). The delta adds two
more (`fetchWinbackMembers:72`, `fetchActiveMembers:83`), so "both branches" now names half the
callers.

*Risk*: navigational only — a maintainer reading the invariant undercounts who depends on it.
*Fix*: `both branches` → `all four recipient branches`.

### M2 — `src/application/resolve-campaign-members-chunks.ts:54-68` — the walk's row-REMOVAL direction is undocumented, and the delta is what makes it reachable on `winback`

The docstring covers one direction of the OFFSET hazard: a row INSERTed mid-walk shifts later rows
down a position and the boundary row is returned **twice** — closed by `dedupeById`. The mirror
case is not stated and is not closed: a row that **leaves** the matched set mid-walk shifts later
rows *up* a position, so the member who sat at offset `k·1000` is never returned. Worked example on
a 2,400-row set: page 1 returns positions 0–999; member at position 5 stops matching; page 2 asks
for offset 1000, which is now the *old* position 1001 — the old position-1000 member is silently
dropped. `dedupeById` cannot see a drop, and the symptom is a `completed` campaign with a
plausible recipient count.

Why the delta matters here: for the two RPC branches the predicate is tag membership / campaign
selection, both changed only by deliberate merchant action. `fetchWinbackMembers:68` filters on
`last_visit_at`, which ordinary customer activity mutates — and a winback member visiting is
exactly the event that removes them from the set. Loss is bounded at one recipient per removal
during a walk measured in seconds, so the expected value is near zero.

*Why this is MINOR, not a re-opened finding*: this is the same hazard class the analyzer's I-1
raised and closed by explicit agreement — `dedupeById` now, keyset paging (`p_after uuid`) deferred
as plan-sized. The delta widens the surface from two branches to four; it does not re-break the
decision.
*Fix*: one sentence in the docstring naming the removal direction and stating that `dedupeById`
does not cover it, and add the two new branches to the deferred keyset follow-up so it is costed
against four call sites rather than two.

### M3 — `package.json:17` — `test:db` uses a POSIX-only inline env assignment

`"test:db": "RUN_DB_TESTS=1 vitest run …"` runs under `sh`/`zsh` and is inert under Windows
`cmd.exe`. No other script in this `package.json` prefixes an env var, so there is no precedent
either way, and the whole DB rig (`psql`, a scratch database, `PGDATABASE`) is a POSIX workflow
already.

*Risk*: none for this team.
*Fix*: none recommended — recorded so a future contributor on Windows knows why the script is
silent rather than assuming a broken gate. `cross-env` would be the change if it ever matters.

---

## ✅ Checked and found sound

**F1 — paging `fetchActiveMembers` / `fetchWinbackMembers` (`resolve-campaign-members.ts:35-84`)**

- The builder is constructed **inside** the fetcher closure (`activeMembersOf(supabase, …)` on
  every page), not hoisted. This is the trap the fix could easily have fallen into: a
  `PostgrestFilterBuilder` is a single-use thenable, and reusing one across pages would append a
  second `.range()` to a mutated URL. Correct as written.
- `readAllPages` contract honoured on both branches: `.order('id')` supplies the total order the
  helper's docstring requires (`id` is the PK, so no ties, no NULL ordering question);
  `.range(from, to)` is inclusive on both ends, so `(0, 999)` is exactly `READ_PAGE_SIZE`;
  the loop terminates on an **empty** page and advances by rows **received**, so a server-truncated
  short page (project `max-rows` below `pageSize`) neither stops the walk early nor skips the
  withheld rows.
- No gap and no duplicate from the paging arithmetic itself. Walked the 1,500-row case by hand
  against the committed assertion `[[0,999],[1000,1999],[1500,2499]]`: page 2 receives 500 rows, so
  the cursor advances to 1500 — *not* to 2000 — and page 3 is the empty terminator. That is the
  right offset, and the test pins it rather than pinning a round number.
- `dedupeById` on both new branches is beyond what F1 asked for and is the right call: it makes all
  four branches carry the same cross-page guarantee instead of two of four.
- **Winback cutoff**: `cutoff` is computed once at `:59-61`, outside the closure, and re-applied
  per page at `:68`. Had it been computed inside, every page would have used a later cutoff and the
  set would have drifted mid-walk. The test asserts `new Set(cutoffs).size === 1` across all three
  pages — the precise claim.
- **Error path preserved**: `readAllPages` throws `` `${label}: ${error.message}` `` with labels
  `'fetchActiveMembers'` / `'fetchWinbackMembers'`, byte-identical to the messages the deleted
  `throw new Error(...)` lines produced. No log/alert regression.
- **≤1,000 audiences**: same table, same `MEMBER_COLUMNS`, same two `.eq()` predicates, same
  winback `.lt()` — identical row set. Two differences, both benign: rows now arrive in `id` order
  (previously arbitrary), and the walk costs one extra empty-page request. The ordering is
  neutralised downstream anyway — `execute-campaign-batch.ts:56` re-sorts via
  `sortByEngagementTier` for the default `engagement_tier` strategy, and `naive` documents itself
  as insertion-order with no ordering claim.
- **Caller audit (`execute-campaign.ts:46-48`)**: `resolveTargetMembers` has exactly one non-test
  caller. It assumes neither order nor count — it filters on `status`, takes `.length`, and hands
  the array to `sendInBatches`. Behaviour change is real but is the fix (see Open Questions).
- **Downstream fan-out is still bounded**: the obvious follow-on worry from an unbounded audience
  is that `.in('phone_e164', phones)` blows the PostgREST URL the way `.in('id', ids)` did in #162.
  It does not: `execute-campaign-batch.ts:57` chunks through `planChunks`
  (`execute-campaign-batch-chunker.ts:20-28`, 100/100 by default, 20 for `naive`) and
  `loadMarketingGateDecisions` is called **per chunk**, so consent and cooldown lookups see ≤100
  phones regardless of audience size.

**F2 — shared `planDerivedDefaults`**

- Both paths now resolve the identical object from the identical function
  (`check-campaign-guardrails.ts:116-125`); the admin route no longer computes a quota of its own,
  so divergence is structurally impossible rather than kept in sync by discipline.
- Response shape unchanged: the old `{ restaurantId: id, ...DEFAULT_SETTINGS }` and the new return
  `{ restaurantId, ...DEFAULT_SETTINGS, monthlySendLimit }` differ in exactly the one field this
  finding is about. No other key added, removed, or renamed — no UI contract change.
- **Authorization is untouched.** `assertPlatformAdmin()` → `checkAdminRateLimit(userId)` →
  `UUID_REGEX` still run in that order and still gate both GET and PUT (`route.ts:21-28`,
  `:54-61`). `planDerivedDefaults(id)` is called at `:37`, *after* all three, on the already
  validated tenant id. PUT is not touched at all. No cross-tenant surface: the only new read is
  `getRestaurantPlan(id)` on the same id the caller is already authorised to view.
- `DEFAULT_SETTINGS` import removal leaves no dangling reference — `grep` shows the symbol still
  referenced by `check-campaign-guardrails.ts:7,124`, `campaign-settings-mapper.ts`, and two test
  files, none of which route through `route.ts`. TS + the 103-test run confirm.
- The `console.warn` on an admin GET is acceptable and is the right place for it: a missing
  `tenant_campaign_settings` row after 078's backfill is precisely the anomaly the warning exists
  to surface, one line per request, and only on the anomalous branch. The test asserts it fires
  exactly once, so it cannot silently become per-row noise.
- Layering is correct: an API route (infrastructure/presentation) importing from `application/` is
  the permitted direction; nothing in `domain/` gained a dependency.
- Fail-closed is consistent: `getRestaurantPlan` throwing now 500s this GET where it previously
  returned starter defaults. That matches `resolveSettings`' documented fail-closed stance (D3) and
  is preferable to rendering a fictional quota.

**F3 — `test:db` + header**

- The script names the single runnable file, so `npm run test:db` is green-by-construction rather
  than red-by-construction. Verified the gate still closes by default: the file reports
  `19 skipped` under a plain `vitest run`.
- The header's factual claims all check out: `PGDATABASE` really does default to `scratch_camp_fix`
  (`:60`), which is a name that does not normally exist, so a misfire fails loudly in `beforeAll`
  instead of seeding a real database; the four named companions
  (`stamp-rpc` / `stamp-rls` / `platform-settings` / `coupon-claim-idempotency`) really are the
  other four `*.db.test.ts` files in that directory; and the two-step instruction matches the
  recorded run.
- Fixture cleanup is `DELETE FROM restaurants WHERE id IN ('<A>','<B>')` by exact id — no prefix
  sweep, consistent with the project's standing rule after TPL-011.

**F4 — the partition assertions**

- The claim is set-level, which is the only claim that catches the failure it is aimed at. The
  count-level case (`1000 + 500, then empty`) is kept as a cheap smoke test, but the load-bearing
  assertions are `INTERSECT` = 0 and `EXCEPT` = 0 in both directions plus `UNION` = 1,500 — a body
  that re-sorted before windowing would satisfy the counts and fail these. The fix artifact's
  mutation run demonstrates exactly that asymmetry.
- 1,500 is the right fixture size: it spans two `p_limit = 1000` pages *unevenly*, so a boundary
  error shows up as a wrong number rather than a symmetric-looking one.
- Both RPCs are covered by the same `it.each` table, so the two functions cannot drift.

**Test-helper rewrite (`setupChain`, `resolve-campaign-members.test.ts:75-113`)**

- It models the PostgREST semantics the production code actually relies on: `.range(from, to)`
  resolves to `rows.slice(from, to + 1)` (inclusive upper bound), a window past the end resolves to
  `[]` (empty-page termination), and `.eq` / `.lt` / `.order` are chainable and order-independent.
- It is fail-loud, not fail-open. `.range()` is the only thing that resolves the chain, so a
  regression to an unpaged select would `await` a non-thenable object, destructure
  `{ data, error }` as `undefined`, and return `[]` — every one of the 7 `setupChain` tests fails.
  The RED commit `806a77a1` records exactly that: 7 failed / 21 passed against the old
  implementation.
- No test now passes for the wrong reason. The 5 pre-existing cases keep their original claims
  verbatim (`git diff` shows zero changes inside them) and still exercise a real 2-request walk.
  The two new cases assert what the mock can honestly witness — page ranges, per-page filters,
  per-page ordering, cutoff identity across pages — and never assert that filtering *worked*, which
  a JS mock cannot prove; that claim lives in the DB test where it belongs.
- The deleted `mockEq` / `mockLt` module-level spies were never asserted on in the old file
  (verified against `c3a7c769`), so removing them cost no coverage.
- The `error` field of `setupChain`'s argument is now ignored, but its type is `error: null`, so TS
  forbids passing anything else — a future author cannot silently write a test that believes it is
  exercising an error path.

**Surgical Changes**: the full delta is 4 product files + 3 test files + `package.json` + 4
workspace docs. Every product hunk maps to F1 or F2; `package.json` to F3; the DB test to F3/F4.
No adjacent code improved, no unrelated formatting, no drive-by refactor. `supabase/` unchanged.
`resolve-campaign-members.ts` lands at exactly 150 lines — at the budget, not over it.

---

## Open Questions

1. **The F1 fix changes production behaviour on the first send after deploy, in two directions.**
   `execute-campaign.ts:46-48` now passes the *true* audience size to
   `enforceCampaignGuardrails`. For a tenant whose real audience exceeds 1,000, a promo/winback run
   that previously sent 1,000 and reported `completed` will now either send the full audience (more
   recipients, more spend) or be **blocked outright** if the true count breaches the monthly quota.
   Blocking is the correct fail-closed outcome and is the point of the fix, but a merchant will
   experience it as "my campaign stopped working". The dev flagged this in the fix artifact's
   Review Hand-off; this review's ask is only that it reaches the release runbook / deploy artifact
   rather than being discovered.
2. **The deferred OFFSET cost curve (F5) now covers four branches, not two.** `fetchActiveMembers`
   and `fetchWinbackMembers` are range walks over `members` (`idx_members_restaurant`); a 100,000
   member `pro` promo audience is 101 page reads with the same re-sort-and-discard shape as the
   RPCs. One measurement on the post-deploy smoke call covers all four. No new work — just widen
   the scope of the follow-up already recorded.

---

## Verdict: APPROVED

All four findings closed correctly, no regression introduced, nothing in the delta untraceable to
F1–F4, no test weakened or deleted. The three MINOR items are comment-level and portability-level;
fold them into the next touch of these files rather than spending a fix round.

## Next Steps

1. No fix round required. Merge PR #164 on the strength of the earlier passes' verdicts plus this
   delta check.
2. Fold M1 + M2 (one comment correction, one added sentence) into the next edit of
   `resolve-campaign-members-chunks.ts`, and extend the deferred keyset follow-up to name all four
   branches.
3. Add Open Question 1 to the CAMP-012/013 release runbook as a named, expected behaviour change.
4. M3 is recorded only; no action.

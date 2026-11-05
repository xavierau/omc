---
id: artifacts/2026-09-10-camp-013-recipient-rpc-backend
type: artifact
author: senior-backend-dev
created: 2026-09-10
status: active
supersedes: null
superseded_by: null
related: [plans/2026-09-10-camp-012-013-guardrail-defaults-and-recipient-rpc, kanban:CAMP-013, github:162]
---

# WI-2 — #162 campaign recipient resolution via set-returning RPCs

Branch `fix/camp-013` (worktree `whatsapp-crm-camp-013`, forked from `fix/issues-161-162` @ 7ee475dd).
WI-2 only. WI-1 (migration 078, guardrail defaults) is owned by a sibling worktree and was not touched.

Commits:
- `86144768` `test(camp-013):` frozen acceptance suite, committed red (17 failed | 7 passed)
- `10dfa76a` `fix(camp-013):` migration 079 + the two RPC call sites

## Files Changed

| File | Lines | Purpose |
|---|---|---|
| `supabase/migrations/079_active_members_rpcs.sql` | +128 (new) | `active_members_by_tags(uuid, uuid[], int, int)` and `active_members_by_campaign_selection(uuid, uuid, int, int)`, both `RETURNS TABLE` = `MEMBER_COLUMNS`, `LANGUAGE sql STABLE`, + the 064 REVOKE PUBLIC/anon/authenticated & GRANT service_role lockdown on both exact signatures |
| `src/application/resolve-campaign-members.ts` | 146 → 135 | `fetchTagMembers` / `fetchSelectedMembers` now page one `.rpc()` per page through `readAllPages`; `MEMBER_COLUMNS` exported (D8); `MEMBER_ID_CHUNK_SIZE` + `fetchMembersByIds` deleted |
| `src/application/resolve-campaign-members-chunks.ts` | 85 → 52 | `chunk()` and `fetchTaggedMemberIds` deleted (resolve-campaign-members.ts was their only importer — grepped); `READ_PAGE_SIZE` + `readAllPages` kept; module header and the `.range()`-only wording in `readAllPages`' doc updated to cover the RPC window |
| `src/application/__tests__/resolve-campaign-members.test.ts` | 494 → 451 | rewritten to the rpc-paging mock (19 → 24 tests) |
| `src/infrastructure/supabase/repositories/__tests__/recipient-rpc-migration-contract.test.ts` | +138 (new) | B9 static contract test over `079_*.sql` (14 tests) |

Not touched, as instructed: `check-campaign-guardrails.ts`, `campaign-guardrails.ts`, `restaurant-repository.ts`,
migration 078, `.claude/kanban.json`, `execute-campaign.ts` (its `filter(status !== 'unsubscribed')` belt-and-braces stays).

## Key Decisions

- **Paging shape** exactly as D7: `p_limit = to - from + 1`, `p_offset = from`, walked by the existing
  `readAllPages`. `supabase.rpc()`'s builder is a `PromiseLike<{data, error}>`, so it satisfies the
  helper's `fetchPage` contract with no adapter and no type cast.
- **`ORDER BY m.id` inside the function** is what makes offset paging stable — the helper's contract
  ("a total order before the window") now lives in SQL rather than in `.order()` calls.
- **Selection RPC scopes through `campaigns.restaurant_id`** because `campaign_members` is
  `(campaign_id, member_id)` only (015) — verified, the architect's note is correct. No `DISTINCT`:
  the PK makes the join non-duplicating; the migration says so.
- **Selection RPC filters `m.status = 'active'`** (D4). Observable set is unchanged
  (`members.status` CHECK is active/unsubscribed and `execute-campaign.ts:47` already dropped
  unsubscribed rows), but no unsubscribed member's phone number is shipped to the worker any more.
- **`chunk()` / `fetchTaggedMemberIds` deleted, not kept**: `grep -rn` over `src/` + `scripts/`
  confirmed `resolve-campaign-members.ts` was the sole importer. Post-change grep for
  `MEMBER_ID_CHUNK_SIZE|fetchMembersByIds|fetchTaggedMemberIds|chunk(` in `src/` returns only
  prose inside the two updated doc comments.
- **File not renamed**: `resolve-campaign-members-chunks.ts` no longer chunks anything, but the
  rename is churn the plan explicitly deferred. Its header now explains why the name is a fossil.

## Tests

| | Before | After |
|---|---|---|
| `resolve-campaign-members.test.ts` | 19 | 24 |
| `recipient-rpc-migration-contract.test.ts` | — | 14 |
| Full suite (measured after) | — | **534 files passed, 6 skipped; 5613 tests passed, 27 skipped, 2 todo** |

- `npx vitest run` → `Test Files 534 passed | 6 skipped (540)`, `Tests 5613 passed | 27 skipped | 2 todo (5642)`, 37.75s.
  No flakes on this run (the known-flaky WAQ webhook integration tests passed).
- `npx tsc --noEmit` → clean (exit 0).
- `npx eslint` on the four changed/added TS files → clean (exit 0).

**The frozen suite changed once after it was written, and only in the implementation's favour by
whitespace**: the contract test asserts the body contains `m.restaurant_id = p_restaurant_id`, while
067 writes that predicate with two spaces (`m.restaurant_id  = p_restaurant_id`) for column
alignment. I had copied 067's padding into 079 character-for-character; rather than loosen the
assertion I removed the padding from **the migration**. The count/send parity assertion normalises
whitespace, so 079's WHERE clause is still provably the same predicate as 067's. No test case was
weakened, skipped or deleted; `git diff 86144768..10dfa76a -- src/**/__tests__` is empty.

Mapping to the plan's frozen list: B1, B2 (exact rpc name + args, `from()` never reaches a member
table), B3 (no returned member id appears in `JSON.stringify(mockRpc.mock.calls)`, both branches),
B4 (1,200 rows → offsets `[0,1000,1200]`, both branches), B5 (2,500 → `[0,1000,2000,2500]`; exact
multiple → `[0,1000]`; `maxRows=500` → `[0,500,1000,1200]`), B6 (no tags → no rpc; empty tag → one
rpc, `[]`; empty selection → `[]`), B7 (`fetchTagMembers: db down` / `fetchSelectedMembers: db down`),
B8 (dynamic membership; `p_restaurant_id` is the caller's tenant on both branches), B9 (the new
contract test), B10 (`execute-campaign.test.ts` untouched and green).

## Scratch-DB validation

`scratch_camp013` on local Postgres 17.6 (127.0.0.1:54322), auth/storage/extensions/realtime stubbed,
**every migration applied in filename order: 001..077 then 079** — 078 is deliberately absent, which
also proves 079 does not depend on it. Assertions inside `BEGIN … ROLLBACK`, DB dropped after.
Script: `scratchpad/scratch-camp013.sh`, full log `scratchpad/scratch-camp013.out`.

One deviation from the plan's fixture list: the plan's **poison-2** was `(member a1, tag tA1,
restaurant_id B)`, but `member_tags`' PK is `(member_id, tag_id)` (065), so that pair collides with
the honest `(a1, tA1, A)` row. Poison-2 is carried by a fresh active tenant-A member `a4` instead —
same proof (an `mt.restaurant_id` that lies about the tenant), and it additionally makes the
`mt.restaurant_id` predicate the *only* thing that can exclude the row on an A call.

```
== migrations applied cleanly (last: 079_active_members_rpcs.sql) ==

 --- step 2/3: parity with count_active_members_by_tags + dedupe ---
 subset_label | rpc_rows | count_rpc | members
--------------+----------+-----------+---------
 {tA1}        |        2 |         2 | A1,A2
 {tA2}        |        1 |         1 | A1
 {tA1,tA2}    |        2 |         2 | A1,A2
NOTICE:  steps 2+3 passed: count/send parity on 3 subsets, two-tag member returned once

 --- step 4: cross-tenant poison ---
    call     | members
-------------+----------
 A calls tA1 | A1,A2
 B calls tA1 | (0 rows)
NOTICE:  step 4 passed: both poisoned member_tags rows yield no recipient

 --- step 5: unsubscribed member excluded from both RPCs ---
NOTICE:  step 5 passed: a3 (unsubscribed) absent from both RPCs

 --- step 6: paging a 1,500-member audience (tags) ---
      page       | count
-----------------+-------
 page(1000,0)    |  1000
 page(1000,1000) |   500
 page(1000,1500) |     0
 limit NULL      |  1500
NOTICE:  step 6 passed: 1000+500 pages, disjoint, union = 1500, offset 1500 empty, NULL limit = 1500

 --- step 7: selection RPC ---
    call    | members
------------+----------
 A calls cA | A1
 B calls cA | (0 rows)
         page          | count
-----------------------+-------
 cBULK page(1000,0)    |  1000
 cBULK page(1000,1000) |   500
 cBULK page(1000,1500) |     0
NOTICE:  step 7 passed: cA -> {a1} only, B denied, 1,500-member selection pages disjointly

 --- step 8: 064 lockdown (SET ROLE) ---
NOTICE:  step 8: anon denied -> permission denied for function active_members_by_tags
NOTICE:  step 8: authenticated denied -> permission denied for function active_members_by_tags
NOTICE:  step 8: anon denied -> permission denied for function active_members_by_campaign_selection
NOTICE:  step 8: authenticated denied -> permission denied for function active_members_by_campaign_selection
NOTICE:  step 8 passed: anon+authenticated denied on both, service_role reads 2 / 1 rows

 --- step 9 (informational): plan for the 1,500-row tag audience ---
 Limit -> Unique -> Sort (Sort Key: m.id) -> Nested Loop
   -> Bitmap Heap Scan on members m (Recheck: restaurant_id = A; Filter: status = 'active')
        -> Bitmap Index Scan on idx_members_restaurant_id
   -> Index Scan using member_tags_pkey on member_tags mt
        (Index Cond: member_id = m.id AND tag_id = ANY(...); Filter: restaurant_id = A)
ROLLBACK
== fixtures + assertions applied and rolled back cleanly ==
```

**A trap worth recording for the next scratch run**: a bare `CREATE DATABASE` has none of the
platform table grants Supabase applies to `anon`/`authenticated`/`service_role`, so the first
lockdown run "passed" for the wrong reason — every role got `permission denied for table
member_tags`, SQLSTATE 42501, indistinguishable from a function-level denial. The script now
restores `GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role` after the
migrations **and** asserts the caught `SQLERRM` mentions `function`. Without both, a migration that
forgot the REVOKEs entirely would still show green.

## Look-only audit (no fixes shipped — same-class follow-ups)

The architect's three findings are **confirmed**, with one addition. `member-tag-bulk.ts:21`
`assertMembersBelongToTenant` does `.in('id', memberIds)` on ids taken straight from the bulk
tag/untag route body, and `src/app/api/dashboard/members/bulk-tags/route.ts` validates only that
they are UUIDs — there is no length cap, and the members list pages at 500 rows, so one "select all"
on a full page is 500 ids and a 500 to the merchant; `deleteMemberTagsBulk` below it repeats the
shape on `member_tags`. `campaign-members-repository.ts:41` is indeed a second, private copy of the
same function (DRY smell) fed by the `memberIds` of a 'selected' campaign on create/update, so
creating such a campaign above ~390 members fails with `fetch failed`.
`integration-event-repository.ts:87` `findIntegrationEventsByIds` is reached from
`list-integration-deliveries.ts`, which caps `limit` at `MAX_PAGE_SIZE = 500` (line 18, applied
line 49) — the distinct `eventId`s of one page can therefore reach 500 > ~390, while the default 50
is safe. **Addition (not in the plan):** `campaign-members-repository.ts:50` `getCampaignMemberIds`
is an *unpaged* `campaign_members` read, silently capped at `max-rows`; `claim-handler.ts:100`
`isMemberTargeted` calls it for a 'selected' campaign and answers `targeted.includes(memberId)`, so
past 1,000 selected members a legitimate claimer is refused the coupon. The file's own comment says
the *tag* branch was converted to a point query for exactly this reason — the 'selected' branch was
left behind. Same class as #162; the send path no longer depends on it, so it is untouched here.

## Deferred / Tech Debt

- The four audit items above (follow-up 2 in the plan): a generic
  `members_in_tenant(p_restaurant_id, p_member_ids uuid[])` RPC for the two tenant assertions, a cap
  or RPC for the deliveries lookup, a point query for `isMemberTargeted`'s 'selected' branch, and a
  dedupe of the two `assertMembersBelongToTenant` copies.
- `resolve-campaign-members-chunks.ts` filename is now a fossil (rename deferred by the plan).
- No prod/browser verification is possible for this change: it is backend-only and DEV Supabase is
  ~30 migrations behind (memory `incident_no_browser_env_for_db_features`). The prod RPC smoke is
  step 4 of the plan's Release notes and belongs to the release, not to this work item.

## Review Hand-off

- **Perf budget** (plan: `≤ ceil(N/1000) + 1` round trips): met by construction and asserted in
  B4/B5 — 1,200 recipients = 3 rpc calls, 2,500 = 4. Response headers are constant now (the query
  travels in the POST body), so the `content-location` overflow has no size to exceed. Wall time for
  N = 10,000 on prod is *not* measured here — that is the release smoke.
- **Integration Map rows owned by WI-2**: I-2 (migration 079 + 3 REVOKE/1 GRANT each) ✅,
  I-6 (both call sites + `MEMBER_COLUMNS` export + chunk path removed) ✅, I-7 (`chunk`,
  `fetchTaggedMemberIds` deleted, doc comment updated) ✅, I-8/I-9 (WI-2's share: the rewritten
  resolve test + the new contract test) ✅. There is no route, nav entry, enum, DI binding,
  permission, i18n key or feature flag in this work item (I-12, verified): `resolveTargetMembers`
  keeps its signature and its single caller `execute-campaign.ts:46`, so the worker entry point is
  wired by construction and `execute-campaign.test.ts` is untouched and green.
- **Look at**: whether the contract test's normalised-WHERE parity with 067 is the right coupling
  (it will fail if either migration's predicate is edited — that is the intent, but it makes 067
  effectively frozen), and whether the `DISTINCT ON (m.id)` + `ORDER BY m.id` + `OFFSET` combination
  under concurrent status flips is acceptable (the plan accepts it as identical to today's exposure).
- **Not for this PR**: migration 078 and every WI-1 file; the four audit sites.

## Exact next step

WI-2 is complete on `fix/camp-013` (`10dfa76a`), not pushed, no PR. The orchestrator's next moves:
merge/rebase this branch with WI-1's 078 (numbering is already correct and 079 proved independent of
078), run WI-3 step 1 — ONE scratch DB from 001..077 + 078 + 079 in order, replaying WI-1 steps 2–3
and WI-2 steps 2–8 in a single `BEGIN … ROLLBACK` — then `npm run gate` on the merged tree and the
reviewer round.

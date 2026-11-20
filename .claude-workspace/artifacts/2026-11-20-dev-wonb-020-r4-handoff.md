---
id: artifacts/2026-11-20-dev-wonb-020-r4-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-20
status: superseded
supersedes: artifacts/2026-11-20-dev-wonb-020-r3-handoff
superseded_by: artifacts/2026-11-20-dev-wonb-020-r6-handoff
item: WONB-020
round: r4
stage: POC
state: blocked
brief: inline (WONB-020 r4)
base: 3ad7d2ad
head: "7c86184f (code + migration 090) -> 4503aed2 (kanban, poc-log, r3 supersede); this file follows in one docs commit on the same branch (its SHA is the branch head; see ls-remote)"
branch: feature/wonb-020-imported-welcome-claim
pushed: true
gate: {result: pass, at: "2026-11-20", note: "heavy lock, once: vitest 683 files / 7844 tests passed (15 files / 129 skipped, 2 todo); tsc --noEmit printed nothing; eslint on the touched .ts files exit 0"}
next: {owner: main, action: "go/no-go on merging origin/develop into the branch (conflicts only in .claude/kanban.json and .claude-workspace/poc-log.md); then re-review r4 on PR #212"}
blockers:
  - "origin/develop moved after r3 (11e65e6e AGENT-005 #216, 4f10c539 BOOK-008 docs #218). PR #212 is mergeable CONFLICTING / DIRTY; it already was at 3ad7d2ad, before r4. git merge-tree: conflicts ONLY in .claude/kanban.json and .claude-workspace/poc-log.md (both sides appended entries); src/messages/*.json and testid-registry auto-merge. Not merged: brief escalate_if. A merge would also bring develop's ~60 AGENT-005 files into this branch's diff from base."
refs: ["https://github.com/xavierau/omc/pull/212", "kanban:WONB-020"]
---
ac:
  AC-1: "pass: red first (scratchpad r4-ac1-red.log: 7 failed / 37 passed: 5 H1 cases + 2 welcomeOffer assertions); green `npx vitest run src/application/__tests__/register-member.test.ts` 44/44. Covers: attemptWelcomeClaimLock(rest, m-new) before createWelcomeCoupon, release after emitEvent and the QR send; release in finally when onboarding throws; unavailable -> onboarded + warning 'welcome lock unavailable', no release; held -> no mint/join/send + warning; a shared in-memory lock with the first onboarding paused mid-mint: the second JOIN (pre-check finds the row, no join event, no coupon) gets welcome-back, createWelcomeCoupon called once, lock empty after"
  AC-2: "pass: red first (r4-ac2-red.log: 7 failed / 12 passed); green `npx vitest run src/application/__tests__/register-member-web.test.ts` 19/19. Web new member: lock before the mint, release after the join event, release on a mint throw, unavailable -> minted + join event + warning; createOrGetMember 23505 race -> {isNew:false, memberId, whatsappClaimUrl} equal to the pre-check answer, no lock, no mint"
  AC-3: "pass: red first against base coupon files (r4-ac3-red.log: 8 failed / 21 passed); green welcome-offer-coupon, coupon-factory, has-join-event, register-member, mint-welcome-coupon-idempotent 81/81. The welcome-offer test evaluates the real filter strings against rows: promo + welcome_offer=true + campaign NULL -> found / hasWelcomeCoupon true; welcome_offer + campaign retyped to promo -> found; ordinary promo -> null; another tenant's -> null; unmarked welcome-campaign coupon -> found. createCoupon sends welcome_offer: true only when welcomeOffer is true (column omitted otherwise). createWelcomeCoupon -> welcomeOffer true; createCampaignCoupon default false, true when passed; onboardNewMember and registerMemberWeb pass { welcomeOffer: true }"
  AC-4: "pass: red first (r4-ac4-red.log: expected 1 to be +0); green `npx vitest run src/application/__tests__/process-member-create-job.test.ts` 23/23: createdByThisJob + hasJoinEvent throws -> 0 join emits, completeMemberJobSucceeded once, warning 'join event lookup failed' with {jobId: 'mj_abc', memberId: 'm-1', error}"
  AC-5: "pass: throwaway Postgres 16.13 (initdb in the scratchpad, TCP 127.0.0.1:55490, no unix socket), DB scratch_090 with the r3 auth/storage/extensions/realtime stubs, migrations 001..089 applied in order with ON_ERROR_STOP (89 files). In BEGIN..ROLLBACK: 090 applied twice (second: column 'already exists, skipping', UPDATE 0); column boolean NOT NULL default false; backfill true for WELCOME_PLAIN (type welcome) and WELCOME_CAMPAIGN_PROMO (promo of a same-restaurant welcome campaign), false for ORDINARY_PROMO, ADHOC_PROMO, CROSS_TENANT_CAMPAIGN (welcome campaign of another restaurant), REWARD_B (DO-block assert); later insert without the column -> false, with true -> true; after deleting the welcome campaign the coupon has campaign_id NULL, welcome_offer true and the r4 lookup finds it. Seeded 4,200 coupons: the lookup plans as Bitmap Index Scan on idx_coupons_member_id. After ROLLBACK the column is absent; DB dropped; server stopped and its data dir removed. Logs: scratchpad scratch-090.log, scratch-090-plan.log"
  AC-6: "pass: `python3 ~/.claude/bin/resource-lock.py heavy -- sh -c 'npx vitest run; npx tsc --noEmit'` once: Test Files 683 passed | 15 skipped (698), Tests 7844 passed | 129 skipped | 2 todo; tsc output 0 bytes, exit 0. eslint on every touched .ts file: exit 0"
  AC-7: "partial: `rtk proxy git push` 3ad7d2ad..4503aed2, ls-remote == HEAD 4503aed25d0e113d2816f7921ebfe40699808af2 (re-checked after this file's docs commit, see the dev return block); PR body updated (r4 bullets, Release section: 089 and 090 applied before the code with the deploy.sh line numbers and the BOOK-007 Forge log, Test plan, Known gaps); kanban WONB-020 states the same order and lists this file; poc-log r0 line amended (history kept) + r4 line; r3 handoff superseded_by r4; this file written. FAIL: `gh pr view 212` mergeable CONFLICTING / mergeStateStatus DIRTY because origin/develop moved (see blockers). Not merged"
decisions:
  - "H1 held case (deviation from the fixed text 'lock can't be acquired -> still onboarded'): attemptWelcomeClaimLock returns acquired | held | unavailable. Only unavailable (Redis error) fails open. held means a claim took the lock in the gap between createOrGetMember's insert and the new-member acquire; that claim re-checks under the lock, finds no join event or coupon, and runs the full welcome. So the new-member path mints nothing: WhatsApp returns {isNew:true, memberId, pointsBalance:0} with no sends; web returns the existing-member answer (wa.me JOIN link). Onboarding anyway would mint a second coupon on the campaign path: uniq_coupon_campaign_member (053) blocks the second campaign coupon, and onboardViaCampaign then falls back to createWelcomeCoupon, a type welcome coupon on a different index. Undo: treat held like unavailable in the two callers"
  - "Lock helper: attemptWelcomeClaimLock added to welcome-claim-lock.ts; tryAcquireWelcomeClaimLock is now a thin view over it (same null-on-held/error contract, same log lines), so the claim path is unchanged. No withWelcomeClaimLock wrapper: the two callers handle held differently, and an in-module wrapper can't be mocked through the module mock the application tests use"
  - "Claim lookup kept the r2 campaigns!inner leg and changed only the plain leg to .or('type.eq.welcome,welcome_offer.is.true'). The brief's own rule (type welcome OR welcome_offer, tenant-scoped, no dependence on the campaign's current type) holds; the extra leg only widens 'not claimable'. It covers mints that don't set the mark: the partner welcome mint in mint-welcome-coupon-idempotent.ts (outside files_allowed) and old-code mints in the seconds between db push and the daemon restart"
  - "createCoupon spreads welcome_offer into the insert only when true, so every other coupon insert stays byte-identical"
  - "090 backfill matches a welcome campaign of the SAME restaurant (k.restaurant_id = c.restaurant_id), mirroring the repo query's campaigns.restaurant_id filter"
  - "H4 log line carries {jobId, memberId, error message}; memberId is a UUID, no phone, so it stays within the job's I-3 no-PII rule"
  - "member-creation-parity and remap-welcome-preserves-history tests now mock welcome-claim-lock (hermetic, off Redis); remap's two createCampaignCoupon assertions gain { welcomeOffer: true }"
failed:
  - "First red-proof attempt for AC-3 used a zsh unsplit variable; cp failed before any checkout, nothing lost (git diff --stat confirmed). Redone in bash"
invariants:
  - "Web path never mints for an existing member (the race and held branches return the existing-member answer)"
  - "Claim recovery still tells the member a minted code (r2 G1 tests unchanged, green)"
  - "Claim path unchanged: tryAcquireWelcomeClaimLock contract and r1 F3 tests untouched"
  - "Import, decideWelcome, campaign executor, welcome-back copy untouched"
  - "No acceptance case weakened; r2 G2's test was rewritten to the H4 behaviour the brief orders"
unverified:
  - "Prod coupons table size / backfill duration (no prod DB access). The UPDATE touches only welcome coupons; the ADD COLUMN is metadata-only on PG 11+"
  - "Scratch DB is vanilla Postgres 16.13 with Supabase stubs, not the prod Supabase Postgres version"
  - "WhatsApp JOIN on a real number (carried from r2/r3), and a real Redis race between the new-member and claim paths (covered by a shared in-memory lock in AC-1; the r1 real-Redis test covers SET NX semantics)"
review_focus:
  - "src/application/register-member.ts createNewMember (lock + held branch)"
  - "src/application/register-member-web.ts createNewWebMember / welcomeNewWebMember"
  - "src/infrastructure/redis/welcome-claim-lock.ts attemptWelcomeClaimLock"
  - "src/infrastructure/supabase/repositories/coupon-repository.ts (insert spread, .or filter)"
  - "supabase/migrations/090_coupons_welcome_offer.sql"
scope_drift:
  - "Edited src/application/__tests__/member-creation-parity.test.ts and remap-welcome-preserves-history.test.ts (inside the src/application/__tests__/** glob, not named in the brief)"
  - "INDEX.md / active/artifacts.md / handoffs.md not updated: outside files_allowed"
fyi:
  - "Partner welcome mint (src/application/mint-welcome-coupon-idempotent.ts, outside files_allowed) calls createCampaignCoupon without { welcomeOffer: true }, so its coupons are welcome_offer=false. Still blocked: by the campaigns leg while the campaign is welcome-type, and by the partner join event. One-line follow-up if wanted"
  - "Evidence (not committed): /private/tmp/claude-501/-Users-xavierau-Code-js-whatsapp-crm/29e1d11b-4cdc-46e6-8954-17896bb1b088/scratchpad/ r4-ac1-red.log, r4-ac2-red.log, r4-ac3-red.log, r4-ac4-red.log, scratch-db-090.sh, scratch-090-assert.sql, scratch-090.log, scratch-090-plan.sql, scratch-090-plan.log, r4-ac6-vitest.log, r4-ac6-tsc.log, pr212-r4-before.md, pr212-r4-body.md"
next_step: "Main: rule on the develop merge (docs-only conflicts, keep both sides as r1's 4b187620 did); after the merge, gh pr view 212 should read MERGEABLE. Then re-review r4, merge into develop, release (deploy.sh applies 089 + 090 before the restart), and the owner scans the join QR as an imported member on prod."
r5_note: "2026-11-20 r5: merged origin/develop 89160ef5 into the branch, merge commit cbc0c3aa (conflicts only in kanban.json + poc-log.md, both sides kept; BOOK-008 stays in done per develop; vitest 7883 passed, tsc 0)"

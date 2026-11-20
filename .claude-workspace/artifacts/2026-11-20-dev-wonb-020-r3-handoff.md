---
id: artifacts/2026-11-20-dev-wonb-020-r3-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-20
status: active
supersedes: artifacts/2026-11-20-dev-wonb-020-r2-handoff
superseded_by: null
item: WONB-020
round: r3
stage: POC
state: done
brief: inline (WONB-020 r3)
base: 5b4b0c86
head: c404c8bd (migration 089 + kanban + poc-log + r1 supersede); this file and the r2 correction follow in one docs commit on the same branch (its SHA is the branch head; see ls-remote)
branch: feature/wonb-020-imported-welcome-claim
pushed: true
gate: {result: pass, at: "2026-11-20T08:07Z", note: "heavy lock, once: vitest 683 files / 7820 tests passed (15 files / 129 skipped, 2 todo); tsc --noEmit printed no diagnostics. No src change this round"}
next: {owner: main, action: "re-review r2 + r3 on PR #212, merge into develop, release with migration 089 applied"}
blockers: []
refs: ["https://github.com/xavierau/omc/pull/212", "kanban:WONB-020"]
---
ac:
  AC-1: "pass: scratch Postgres 16.13 (throwaway initdb, TCP only), DB scratch_089 with auth/storage/extensions/realtime stubs; migrations 001..088 applied in order with ON_ERROR_STOP (88 files). In BEGIN..ROLLBACK: 089 applied twice (second: 'already exists, skipping'); index def `CREATE INDEX idx_events_join_restaurant_member ON public.events USING btree (restaurant_id, member_id) WHERE (type = 'join'::text)`; seeded 2 tenants / 200 members / 20,002 events (2% join) + a duplicate join for one member (accepted: non-unique, count 2); ANALYZE. EXPLAIN of `select id from events where restaurant_id=$1 and member_id=$2 and type='join' limit 1`: `Limit -> Index Scan using idx_events_join_restaurant_member on events, Index Cond: (restaurant_id = ..) AND (member_id = ..)` with seqscan ON and again with enable_seqscan off. After ROLLBACK the index and seed are gone; DB dropped, server stopped. Coupons: already covered, no index added. With 4,200 seeded coupons: lookup 1 (type=welcome) uses `uniq_coupons_welcome_member` (076, (restaurant_id, member_id) WHERE type='welcome' AND member_id IS NOT NULL); lookup 2 (campaigns!inner type=welcome) uses `idx_coupons_member_id` (001) BitmapAnd `idx_coupons_campaign_id`"
  AC-2: "pass: `python3 ~/.claude/bin/resource-lock.py heavy -- sh -c 'npx vitest run; npx tsc --noEmit'` once: Test Files 683 passed | 15 skipped (698), Tests 7820 passed | 129 skipped | 2 todo; tsc printed nothing (no errors)"
  AC-3: "pass: `rtk proxy git push` 34979790..c404c8bd; `rtk proxy git ls-remote` == HEAD c404c8bd905e1b5ae2301a29389db6a2e7f21e41 (re-checked after the docs commit push, see dev return block); `gh pr view 212`: OPEN, base develop, mergeable MERGEABLE, mergeStateStatus CLEAN, statusCheckRollup [] — the repo has no .github/workflows (no CI); the only commit status is CodeRabbit success 'Review skipped: reviews are disabled for this base branch'. PR body updated (r1/r2/r3 rounds, Release: apply 089). Not merged"
  AC-4: "pass: r1 handoff status superseded, superseded_by r2; r2 handoff committed with pushed: false (corrected), AC-7 rewritten to the truth, head c404c8bd, status superseded by this file; this file written; kanban WONB-020 description says 089 MUST be applied at release (with the size check / CONCURRENTLY note) and lists this handoff; poc-log r3 line"
decisions:
  - "Index name idx_events_join_restaurant_member; non-unique, partial WHERE type = 'join', plain CREATE INDEX IF NOT EXISTS with the 080-style deploy note (check events size, pre-create CONCURRENTLY outside a txn if large). No CONCURRENTLY in the file itself: 053/076/080 all use plain CREATE INDEX in the migration"
  - "No coupons index: idx_coupons_member_id (member_id is a per-member UUID, so restaurant_id only re-checks a few rows) and 076's uniq_coupons_welcome_member already serve both findLatestWelcomeOfferCode queries; planner confirmed on seeded data"
  - "r2 handoff set to superseded by this file (workspace-protocol chain r0 -> r1 -> r2 -> r3); its body kept, only pushed/head/AC-7/status changed"
failed: []
invariants:
  - "No src/ change in r3; r2 code 5b4b0c86 is the reviewed candidate"
  - "Migration 089 is additive and idempotent; no code depends on it"
unverified:
  - "Index build time / lock on prod events (table size not checked: no prod DB access from this run). Release step: count first, CONCURRENTLY if large"
  - "Scratch DB is vanilla Postgres 16.13 with Supabase stubs, not the prod Supabase Postgres version"
  - "WhatsApp JOIN claim on a real number (carried from r2)"
review_focus:
  - "supabase/migrations/089_events_join_member_index.sql"
scope_drift:
  - "INDEX.md / active/artifacts.md not updated: outside files_allowed"
fyi:
  - "Scratch build script and logs (not committed): /private/tmp/claude-501/-Users-xavierau-Code-js-whatsapp-crm/29e1d11b-4cdc-46e6-8954-17896bb1b088/scratchpad/scratch-db-089.sh, scratch-089-assert.sql, scratch-089.log, scratch-089-coupons.sql, scratch-089-coupons.log, ac2.log"
  - "The supabase_db_oma docker container named in memory project_validate_migrations_on_scratch_db is gone; a throwaway Homebrew Postgres (initdb in the scratchpad, unix sockets off because the path exceeds 103 bytes) works the same"
next_step: "Re-review r2 + r3 on PR #212, merge into develop, release and apply migration 089; owner scans the join QR as an imported member on prod."

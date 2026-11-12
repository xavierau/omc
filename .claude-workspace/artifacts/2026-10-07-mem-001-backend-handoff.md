---
id: artifacts/2026-10-07-mem-001-backend-handoff
type: handoff
contract: handoff-file-v1
author: senior-backend-dev
created: 2026-10-07
status: active
item: MEM-001
state: done
brief: inline
base: b9f1f25
head: 7c1b92f2
branch: feature/mem-001-members-table
pushed: false
stage: poc
gate: {result: none, at: none}
next: {owner: react-frontend-dev, action: "build members table UI against the quality contract"}
blockers: []
refs: [kanban:MEM-001]
---
ac:
  AC-1: {result: pass, evidence: "npx vitest run src/domain/value-objects/__tests__/contact-quality.test.ts: 11 passed (unreachable->red, 0 sample->unknown, 0.90 green / 0.8999 yellow / 0.60 yellow / 0.5999 red)"}
  AC-2: {result: pass, evidence: "npx vitest run src/app/api/dashboard/members/__tests__/route.test.ts: 26 passed (250 honoured, 300->250, tagId=none passes through, tagId=abc 400, quality on every member, RPC error -> 200 unknown + console.warn)"}
  AC-3: {result: pass, evidence: "scratch PG17, migrations 001..079 + auth/storage stubs, 080 applied inside BEGIN..ROLLBACK (function absent afterwards). Seeded aa01: 3 delivered(2 delivered+1 read), 1 failed, plus sent, queued, inbound, a >90d failed, and another tenant's row. RPC returned aa01 delivered=3 failed=1, aa02 0/0, tenant-B member omitted; tenant A asking only for a tenant-B id -> 0 rows. Grants: service_role t, anon f, authenticated f. Planner uses idx_wa_messages_member_queued (index-only scan)."}
  AC-4: {result: pass, evidence: "tsc --noEmit under resource-lock heavy: clean (exit 0, no output). eslint on touched files: 0 warnings/errors in touched files (repo uses npm; pnpm not installed)."}
  AC-5: {result: pass, evidence: "kanban.json MEM-001 in_progress; committed on feature/mem-001-members-table, not pushed"}
failed: []
decisions:
  - "Contract per member: quality {rating:'green'|'yellow'|'red'|'unknown', deliveryRate:number|null, sampleSize:number}. unreachable_at is selected for the rating and stripped from the wire (not in the response)."
  - "RPC takes a third param p_window_days int DEFAULT 90, filled from CONTACT_QUALITY_WINDOW_DAYS, so the 90 lives in one place (domain constant). Brief named only 2 params; default keeps the 2-arg call valid."
  - "Zero-tags filter = PostgREST left embed 'tag_filter:member_tags(tag_id)' + .is('tag_filter', null), keeps count:exact and range paging; sentinel NO_TAG_FILTER='none' exported from member-repository."
  - "Degrade lives in getMemberQualitiesSafe (same file as the RPC call); route merges. On RPC error every member = unknown, even unreachable ones, per brief."
  - "Index is created in 080 as idx_wa_messages_member_queued; IF NOT EXISTS."
invariants:
  - "Quality merge reads only members of the CURRENT page (<=250 ids) via RPC, never .in()."
  - "Thresholds/window only in src/domain/value-objects/contact-quality.ts."
unverified:
  - "tagId=none anti-join against a REAL PostgREST: not run (no DEV DB / browser env; type-checks, unit tests mock the repo). Needs one smoke on a preview/DEV with the members page: ?tagId=none must return only untagged members with correct total. Owner: caller / frontend walk."
  - "080 not applied to DEV or prod (per brief); until applied the column shows unknown (degrade path)."
  - "Full vitest suite not run (POC; touched files only)."
review_focus:
  - "src/infrastructure/supabase/repositories/member-list-query.ts: TAG_ABSENT_EMBED + .is('tag_filter', null) branch"
  - "supabase/migrations/080_member_delivery_quality.sql: tenant predicates on both joins"
scope_drift:
  - "src/infrastructure/supabase/repositories/member-list-query.ts — getMembers lives here (re-exported by member-repository.ts), not matched by the member-repository*.ts glob; the no-tag filter and unreachable_at select could not be done elsewhere. Flagged for caller; no one pre-approved."
next_step: "Frontend: add 20/50/100/250 selector, no-tag option sending tagId=none, quality column reading member.quality; apply 080 on DEV before browser walk."
---

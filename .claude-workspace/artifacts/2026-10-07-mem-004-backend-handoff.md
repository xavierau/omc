---
id: artifacts/2026-10-07-mem-004-backend-handoff
type: handoff
contract: handoff-file-v1
author: senior-backend-dev
created: 2026-10-07
status: active
item: MEM-004
state: done
brief: inline (r2)
base: 9f106b02
head: see git log
branch: feature/mem-001-members-table
pushed: false
stage: poc
gate: {result: none, at: none}
next: {owner: none, action: "apply 081 to DEV then prod before/with deploy; reviewer optional"}
blockers: []
refs: [kanban:MEM-004, kanban:MEM-001]
---
ac:
  AC-1: {result: pass, evidence: "npx vitest run src/application/__tests__/restore-member-reachability.test.ts: 4 passed (clear+event payload, null -> no event, repo failure warn, event failure warn). Plus repo test member-clear-unreachable.test.ts: 4 passed (tenant-scoped read+write, CAS on previous value, patch only unreachable_at, null on no row / lost race)."}
  AC-2: {result: pass, evidence: "src/app/api/webhooks/whatsapp/__tests__/route.reachability-restore.integration.test.ts: 4 passed. Inbound text -> restore called with {rest-1, +85291234567, text}; inbound image -> messageType image; kapso-v2-delivered and kapso-v2-failed-131042 status webhooks -> not called. Also green: handlers.test, route.window-tracking, route.opt-in-prompt, route.sender-guard, event-type (121 tests total over 8 touched/related files)."}
  AC-3: {result: pass, evidence: "scratch PG16 (temp cluster, port 55432, stopped after), auth/storage/extensions stubs, migrations 001..080 applied with 0 errors, then BEGIN..ROLLBACK: before 081 'reachability_restored' rejected (events_type_check); after 081 all 19 existing types insert (count 19), new type inserts (1 row), 'bogus_type' rejected; events count 0 after rollback. FK/triggers skipped via session_replication_role=replica (only the CHECK is under test). Script: scratchpad test081.sql."}
  AC-4: {result: pass, evidence: "tsc --noEmit under resource-lock heavy: only error is pre-existing .next/dev/types/validator.ts (stale ref to deleted src/app/mem001-preview/page, gitignored .next); no src errors. eslint on all 7 touched src files: clean. Committed on branch, not pushed; CLAUDE.md left uncommitted."}
failed: []
decisions:
  - "Hook point: routeMessage (handlers.ts) right after bumpServiceWindow, before maybeHandleLanguageCommand, so it runs once per inbound message even when a later handler returns early. Tenant (resolved by route) and sender phone are both known there; member resolution happens inside the repo query. Covers every message type incl. flow replies. Status/quality/template webhooks never reach routeMessage."
  - "No port interface added: the use case imports the infra repo function directly like the sibling use cases (stamp-nudge, dispatch-error-action)."
  - "Clear = read (restaurant_id + phone + unreachable_at IS NOT NULL) then UPDATE ... WHERE restaurant_id AND id AND unreachable_at = <value read> returning id (compare-and-swap). PostgREST cannot RETURN the pre-update value in one statement without an RPC/migration; the CAS keeps it idempotent, tenant-scoped in the query, and guarantees exactly one event per actual clear under concurrent inbounds."
  - "Event goes through emitEvent (persist + listener dispatch), matching other domain events; failure of either step is caught + console.warn + log('warn'). With 081 unapplied the clear still succeeds and only the event warns."
  - "Kanban: MEM-004 placed in in_progress next to MEM-001 (branch not merged; done column holds merged work). Move to done on merge if you read 'done when committed' differently."
invariants:
  - "pmm_throttled_until and consent are untouched."
  - "081 list == 050's 19 types + reachability_restored == EventType union."
unverified:
  - "Real PostgREST: .not('unreachable_at','is',null).maybeSingle() read and the .eq('unreachable_at', <iso>) CAS match against a real timestamptz round-trip (value read back as a string and compared as text by PostgREST). Mocks only. Needs one smoke on DEV with a member whose unreachable_at is set: send an inbound, expect the column NULL + one event row."
  - "081 not applied to DEV or prod (per brief)."
  - "Full vitest suite not run (POC; touched/related files only)."
review_focus:
  - "src/infrastructure/supabase/repositories/member-quality-state.ts: clearMemberUnreachable CAS, timestamp string equality"
  - "src/app/api/webhooks/whatsapp/handlers.ts: added await in the hot inbound path (two extra queries only when the flag may be set: the read is one indexed lookup per inbound)"
scope_drift: []
next_step: "Apply 081 on DEV, smoke one inbound for a flagged member, then ship with the branch."
---

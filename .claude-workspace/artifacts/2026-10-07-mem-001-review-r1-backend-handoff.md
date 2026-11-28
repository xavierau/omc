---
id: artifacts/2026-10-07-mem-001-review-r1-backend-handoff
type: handoff
contract: handoff-file-v1
author: senior-backend-dev
created: 2026-10-07
status: active
item: MEM-001
state: done
brief: inline
base: 8b161da04b4be16dceca6eaa432051ff66f77d67
head: 021368e4
branch: feature/mem-001-members-table
pushed: false
stage: poc
gate: {result: none, at: 2026-10-07}
next: {owner: none, action: "main: frontend round sends include=quality; re-review"}
blockers: []
refs: []
---
ac:
  AC-1: {result: pass, evidence: "route.test.ts green (51 tests across 5 touched files)"}
  AC-2: {result: pass, evidence: "member-quality-evidence.test.ts"}
  AC-3: {result: pass, evidence: "member-clear-unreachable.test.ts, restore-member-reachability.test.ts, route.reachability-restore.integration.test.ts"}
  AC-4: {result: pass, evidence: "scratch PG17 001..079 + 080 applied and re-applied; aa01 -> delivered 3 read 2 failed 1 pending 3 (out-of-window and inbound excluded); cross-tenant both directions 0 rows; conditional UPDATE returns id once then 0 rows (rolled back)"}
  AC-5: {result: pass, evidence: "tsc --noEmit: only error is stale untracked .next/dev/types/validator.ts referencing missing src/app/mem001-preview (gitignored); no src errors. Committed, not pushed, CLAUDE.md left out"}
decisions:
  - "include parsed as repeated and/or comma-separated param, token 'quality' — decide_yourself"
  - "evidence 404 path: evidence now runs in parallel, so it is also executed for a missing member and discarded; its own member lookup uses maybeSingle so no warn"
  - "clearMemberUnreachable return type narrowed to { memberId } (previousUnreachableAt dropped)"
  - "RPC return signature changed (adds read, pending) by editing 080 in place; list caller ignores extra columns"
failed: []
invariants:
  - "list rows always strip unreachable_at from the wire, with or without include=quality"
unverified:
  - "members page frontend does not yet send include=quality: quality column is empty until the next frontend round (not mine)"
  - "full suite and lint not run (touched-file runs only per brief)"
review_focus:
  - "src/infrastructure/supabase/repositories/member-quality-evidence.ts: counts (RPC) and recent list (query) are two snapshots, may differ by a message in flight"
scope_drift: []
in_flight: []
next_step: "Frontend round adds include=quality to the members page fetch."

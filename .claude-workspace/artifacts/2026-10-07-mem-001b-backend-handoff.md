---
id: artifacts/2026-10-07-mem-001b-backend-handoff
type: handoff
contract: handoff-file-v1
author: senior-backend-dev
created: 2026-10-07
status: active
item: MEM-001
state: done
brief: inline
base: b8d8f6dd
branch: feature/mem-001-members-table
pushed: false
stage: poc
gate: {result: none, at: none}
next: {owner: react-frontend-dev, action: "render qualityEvidence in the contact detail panel"}
blockers: []
refs: [kanban:MEM-001, kanban:MEM-002, kanban:MEM-003]
---
ac:
  AC-1: {result: pass, evidence: "vitest contact-quality.test.ts: 19 passed (each reason at its boundary; prior rating assertions intact)"}
  AC-2: {result: pass, evidence: "vitest members route.test.ts: 29 passed (evidence attached, null -> 200, 404 skips evidence, list quality now carries reason)"}
  AC-3: {result: pass, evidence: "member-quality-evidence.test.ts (7 passed) asserts .eq restaurant_id + member_id + direction=outbound on whatsapp_messages, .eq id + restaurant_id on members, select lacks content_preview and *"}
  AC-4: {result: partial, evidence: "tsc --noEmit under heavy lock: single error in gitignored .next/dev/types/validator.ts referencing deleted src/app/mem001-preview/page (stale generated file, not in diff); no errors in src. eslint on 6 touched files: clean. Committed, not pushed. kanban MEM-002/MEM-003 in backlog."}
failed: []
decisions:
  - "Counts from fetched rows (all in-window outbound, cap 5000), not the RPC: gives read/pending too. At the cap the fetch throws -> evidence null, rather than counts that could disagree with the list RPC."
  - "Evidence lives in new member-quality-evidence.ts (its own member flags query: unreachable_at, pmm_throttled_until); member-detail-repository untouched. Route attaches it after the 404 check."
  - "ContactQuality gains reason; existing list tests' toEqual expectations updated to include it (additions only)."
unverified:
  - "Not run against real PostgREST/DB (080 not applied on DEV); queries are mock-chain tested only."
  - "Stale .next/dev/types error: delete .next/dev to clear."
scope_drift: []
next_step: "Frontend: panel reads qualityEvidence (null -> hide section); quote thresholds/windowDays from payload."
---
